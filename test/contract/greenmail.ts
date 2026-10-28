// A fake mail server for the email tests: GreenMail (greenmail/standalone),
// with made-up accounts, on a Docker network of its own that the Hermes under
// test joins, so Hermes reaches it as `mail` (IMAP on 3143, SMTP on 3025,
// both without TLS; 3993 and 3465 speak TLS with a self-signed certificate).
// The tests reach it from this machine: its SMTP to put mail in an inbox, and
// its REST API to see what landed where.

import { execFile } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const GREENMAIL_IMAGE = 'greenmail/standalone:2.1.5'

/** The accounts on it: login is the address, and the password stands in for an app password. */
export const MAILBOXES = {
  ada: { address: 'ada@example.com', password: 'ada-app-password-0001' },
  cy: { address: 'cy@example.com', password: 'cy-app-password-0002' },
  bob: { address: 'bob@example.com', password: 'bob-password' },
} as const

/** Where Hermes finds it, from inside its container. */
export const MAIL_HOST = 'mail'
export const PORTS = { imap: 3143, smtp: 3025, imaps: 3993, smtps: 3465 } as const

export type Stored = { uid: string; 'Message-ID': string | null; subject: string; mimeMessage: string }

export type GreenMail = {
  /** Puts a message in someone's inbox, as if it came from elsewhere. Resolves once it's stored. */
  deliver: (message: { from: string; to: string; subject: string; text: string; date?: Date; headers?: Record<string, string> }) => Promise<void>
  /** What's in one of an account's folders. */
  messages: (address: string, folder?: string) => Promise<Stored[]>
  /** Empties every folder of every account (the folders stay). */
  purge: () => Promise<void>
  stop: () => Promise<void>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function port(container: string, inside: number) {
  const { stdout } = await run('docker', ['port', container, `${inside}/tcp`])
  const found = stdout.match(/:(\d+)\s*$/m)?.[1]
  if (!found) throw new Error(`GreenMail's port ${inside} isn't published`)
  return Number(found)
}

/** A GreenMail that the Hermes container `hermes` can reach as `mail`. */
export async function startGreenMail(hermes: string): Promise<GreenMail> {
  const name = `${hermes}-mail`
  const network = `${hermes}-mail-net`
  await run('docker', ['rm', '-f', name]).catch(() => {})
  await run('docker', ['network', 'rm', network]).catch(() => {})
  await run('docker', ['network', 'create', network])
  const users = Object.values(MAILBOXES)
    .map((u) => `${u.address.split('@')[0]}:${u.password}@${u.address.split('@')[1]}`)
    .join(',')
  const options = [
    '-Dgreenmail.setup.test.all',
    '-Dgreenmail.hostname=0.0.0.0',
    '-Dgreenmail.tls.keystore.file=/home/greenmail/greenmail.p12',
    '-Dgreenmail.tls.keystore.password=changeit',
    `-Dgreenmail.users=${users}`,
    '-Dgreenmail.users.login=email',
  ].join(' ')
  const stop = async () => {
    await run('docker', ['network', 'disconnect', '-f', network, hermes]).catch(() => {})
    await run('docker', ['rm', '-f', name]).catch(() => {})
    await run('docker', ['network', 'rm', network]).catch(() => {})
  }
  try {
    await run('docker', [
      'run', '-d', '--name', name, '--network', network, '--network-alias', MAIL_HOST,
      '-p', '127.0.0.1::8080', '-p', `127.0.0.1::${PORTS.smtp}`,
      '-e', `GREENMAIL_OPTS=${options}`,
      GREENMAIL_IMAGE,
    ], { maxBuffer: 1 << 20 })
    await run('docker', ['network', 'connect', network, hermes])
    const api = `http://127.0.0.1:${await port(name, 8080)}`
    const smtpPort = await port(name, PORTS.smtp)
    const deadline = Date.now() + 60_000
    for (;;) {
      const ready = await fetch(`${api}/api/service/readiness`).then((r) => r.ok, () => false)
      if (ready) break
      if (Date.now() > deadline) throw new Error('GreenMail didn’t start')
      await sleep(500)
    }

    const messages = async (address: string, folder = 'INBOX') => {
      const res = await fetch(`${api}/api/user/${encodeURIComponent(address)}/messages/${encodeURIComponent(folder)}`)
      if (!res.ok) throw new Error(`GreenMail: ${res.status} ${await res.text()}`)
      return (await res.json()) as Stored[]
    }

    const deliver: GreenMail['deliver'] = async ({ from, to, subject, text, date = new Date(), headers = {} }) => {
      const before = (await messages(to)).length
      const lines = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
        `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@example.org>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        '',
        ...text.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
      ]
      await smtp(smtpPort, addressOf(from), [addressOf(to)], lines.join('\r\n'))
      const until = Date.now() + 10_000
      while ((await messages(to)).length <= before) {
        if (Date.now() > until) throw new Error(`The message to ${to} never landed`)
        await sleep(100)
      }
    }

    const purge = async () => {
      const res = await fetch(`${api}/api/mail/purge`, { method: 'POST' })
      if (!res.ok) throw new Error(`GreenMail purge: ${res.status}`)
    }
    return { deliver, messages, purge, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

const addressOf = (who: string) => who.match(/<([^>]+)>/)?.[1] ?? who.trim()

/** Just enough SMTP to hand GreenMail one message. */
function smtp(port: number, from: string, to: string[], data: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    const steps = [
      `EHLO contract.test`,
      `MAIL FROM:<${from}>`,
      ...to.map((t) => `RCPT TO:<${t}>`),
      'DATA',
      `${data}\r\n.`,
      'QUIT',
    ]
    let buffer = ''
    let step = -1
    socket.setTimeout(10_000, () => socket.destroy(new Error('SMTP timed out')))
    socket.on('error', reject)
    socket.on('close', () => (step >= steps.length - 1 ? resolve() : reject(new Error(`SMTP closed early: ${buffer}`))))
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      // A reply is complete at a whole line whose code is followed by a space.
      const lines = buffer.split('\r\n').slice(0, -1)
      const last = lines.findLast((l) => /^\d{3} /.test(l))
      if (!last) return
      buffer = ''
      if (!/^[23]/.test(last)) return socket.destroy(new Error(`SMTP refused: ${last}`))
      step++
      if (step < steps.length) socket.write(`${steps[step]}\r\n`)
      else socket.end()
    })
  })
}
