// Passwords (src/state/vault.ts): the logins, cards and addresses Murmur keeps
// in an agent's vault. Murmur's own vaultActions run here against Hermes, the
// secrets are checked where Hermes keeps them, and a login and a card saved
// from Murmur are filled into real pages by the agent's browser.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { QueryClient } from '@tanstack/react-query'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { composeSoul, createAgent } from '@/state/agents'
import { readVault, vaultActions } from '@/state/vault'
import { api, connect, newChat, turn, type Socket } from './client'
import { toolsTag } from './fake-model'

const run = promisify(execFile)
const inHermes = (...args: string[]) =>
  run('docker', ['exec', '-u', 'hermes', '-e', 'HERMES_HOME=/opt/data', '-w', '/opt/hermes', inject('hermes').container, ...args])

/** What Hermes keeps for each item, secrets included: what fills the page. */
async function stored(profile: string) {
  const script = [
    'import json, sys',
    'from agent.vault_store import get_vault_store',
    's = get_vault_store()',
    'print(json.dumps({m.id: s.resolve_secret(m.id) for m in s.list_items()}))',
  ].join('\n')
  const home = profile === 'default' ? '/opt/data' : `/opt/data/profiles/${profile}`
  const { stdout } = await run('docker', ['exec', '-u', 'hermes', '-e', `HERMES_HOME=${home}`, '-w', '/opt/hermes', inject('hermes').container, 'python', '-c', script])
  return JSON.parse(stdout) as Record<string, Record<string, string>>
}

const vault = vaultActions(new QueryClient(), 'default')
const login = { kind: 'login', site: 'github.com/login', identifier: 'octocat@example.com', password: 'correct horse', otp: 'JBSWY3DPEHPK3PXP' } as const
const card = { kind: 'payment', site: 'www.amazon.com', number: '4242 4242 4242 4242', expiry: '12 / 30', cvc: '123', name: 'Ada Lovelace' } as const
const address = { kind: 'address', site: 'www.amazon.com', line1: '1 Infinite Loop', city: 'Cupertino', state: 'CA', postcode: '95014', country: 'United States' } as const

let other: string | undefined
beforeAll(() => startGateway())
afterAll(async () => {
  for (const entry of await readVault('default')) await vault.remove(entry).catch(() => {})
  if (other) await api.call('DELETE', `/api/profiles/${other}`)
  stopGateway()
})

describe('passwords', () => {
  it('saves a login, a card and an address, and lists only what anyone may see', async () => {
    const ids = { login: await vault.add(login), card: await vault.add(card), address: await vault.add(address) }
    const list = await readVault('default')
    expect(list.find((e) => e.id === ids.login)).toMatchObject({ kind: 'login', label: 'github.com', origin: 'https://github.com', identifier: 'octocat@example.com', otp: true })
    expect(list.find((e) => e.id === ids.card)).toMatchObject({ kind: 'payment', label: 'Visa •••• 4242', origin: 'https://www.amazon.com' })
    expect(list.find((e) => e.id === ids.address)).toMatchObject({ kind: 'address', label: '1 Infinite Loop', origin: 'https://www.amazon.com' })
    expect(list.every((e) => e.added instanceof Date)).toBe(true)
    expect(JSON.stringify(list)).not.toMatch(/correct horse|4242424242424242|JBSWY3DP|Cupertino/)

    // Under the names Hermes fills checkout fields from.
    const secrets = await stored('default')
    expect(secrets[ids.login]).toEqual({ password: 'correct horse', otp_secret: 'JBSWY3DPEHPK3PXP' })
    expect(secrets[ids.card]).toEqual({ card_number: '4242424242424242', exp_month: '12', exp_year: '2030', cvc: '123', cardholder_name: 'Ada Lovelace' })
    expect(secrets[ids.address]).toEqual({ address_line1: '1 Infinite Loop', city: 'Cupertino', state: 'CA', postal_code: '95014', country: 'United States' })
  })

  it('changes an item by putting a new one in its place', async () => {
    const old = (await readVault('default')).find((e) => e.kind === 'login')!
    const id = await vault.replace(old, { ...login, identifier: 'octocat', password: 'new password', otp: '' })
    const list = await readVault('default')
    expect(list.some((e) => e.id === old.id)).toBe(false)
    expect(list.find((e) => e.id === id)).toMatchObject({ identifier: 'octocat', otp: false })
    expect((await stored('default'))[id]).toEqual({ password: 'new password' })
  })

  it('deletes one', async () => {
    const entry = (await readVault('default')).find((e) => e.kind === 'address')!
    await vault.remove(entry)
    expect((await readVault('default')).some((e) => e.id === entry.id)).toBe(false)
  })

  it('says in words what Hermes refused', async () => {
    await expect(vault.add({ ...login, otp: 'not a key!' })).rejects.toThrow('That setup key doesn’t look right')
  })

  it('keeps each agent’s apart', async () => {
    other = await createAgent({ name: `Vault ${Date.now().toString(36)}`, hue: 30, role: 'Shops', soul: composeSoul('Vault', 'Shops', 'warm'), template: 'scout' })
    const theirs = vaultActions(new QueryClient(), other)
    await theirs.add(address)
    expect((await readVault(other)).map((e) => e.label)).toEqual(['1 Infinite Loop'])
    expect((await readVault('default')).some((e) => e.kind === 'address')).toBe(false)
  })
})

describe('the agent’s browser', () => {
  let socket: Socket | undefined
  afterAll(() => socket?.close())

  it('fills a sign-in page and a checkout from what Murmur saved', async ({ skip }) => {
    // The vault rides with Hermes's browser; a Hermes without one has nothing to fill.
    const check = 'import model_tools\nfrom tools.registry import registry\ne = registry._tools.get("browser_vault")\nprint(bool(e and e.check_fn()))'
    if ((await inHermes('python', '-c', check)).stdout.trim() !== 'True') return skip()

    const pages = {
      'login.html': '<form><input name=username autocomplete=username><input id=p type=password autocomplete=current-password><button>Sign in</button></form>',
      'checkout.html': '<form><input autocomplete=cc-name><input autocomplete=cc-number><input autocomplete=cc-exp><input autocomplete=cc-csc><button>Pay</button></form>',
    }
    for (const [file, html] of Object.entries(pages))
      await inHermes('sh', '-c', `mkdir -p /tmp/site && printf '%s' "$0" > /tmp/site/${file}`, html)
    await run('docker', ['exec', '-d', '-w', '/tmp/site', inject('hermes').container, 'python', '-m', 'http.server', '8765', '--bind', '127.0.0.1'])

    const site = 'http://127.0.0.1:8765'
    const loginId = await vault.add({ kind: 'login', site, identifier: 'tester', password: 'pw-from-murmur' })
    const cardId = await vault.add({ ...card, site, name: 'Ada' })

    // A payment card is filled only after the person says so.
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'once' } : undefined))
    const { runtime } = await newChat(socket)
    const page = (name: string) => ({ name: 'browser_exec', args: { code: `new_tab("${site}/${name}"); wait_for_load()` } })
    const fill = (handle: string) => ({ name: 'tool_call', args: { calls: [{ name: 'browser_vault', arguments: { action: 'fill', handle } }] } })
    const lengths = { name: 'browser_exec', args: { code: 'print(js("[...document.querySelectorAll(\'input\')].map(i => i.value.length).join(\',\')"))' } }

    await turn(socket, runtime, `Sign in ${toolsTag([page('login.html'), fill(loginId), lengths])}`)
    await turn(socket, runtime, `Pay ${toolsTag([page('checkout.html'), fill(cardId), lengths])}`)

    const results = socket
      .of(runtime)
      .filter((e) => e.type === 'tool.complete')
      .map((e) => (e.payload as { name: string; result: Record<string, unknown> }))
    const fills = results.filter((r) => r.name === 'browser_vault').map((r) => r.result)
    expect(fills[0]).toMatchObject({ success: true, filled_fields: 1, kind: 'login', origin: site })
    expect(fills[1]).toMatchObject({ success: true, kind: 'payment', origin: site })
    const typed = results.filter((r) => r.name === 'browser_exec' && /^\d/.test(String(r.result.output))).map((r) => String(r.result.output).trim())
    // The password went in, and the username was left for the agent to type.
    expect(typed[0]).toBe('0,14')
    // Name, number, MM/YY and the code. (Read back as lengths: Hermes blanks out any secret the browser echoes.)
    expect(typed[1]).toBe('3,16,5,3')
    expect(socket.requests.find((r) => r.method === 'approval')?.params).toMatchObject({ pattern_keys: ['mcp_elicitation'] })
  })
})
