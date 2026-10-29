// Passwords (src/state/vault.ts): the logins, cards and addresses Murmur keeps
// in an agent's vault. Murmur's own vaultActions run here against Hermes, the
// secrets are checked where Hermes keeps them, and a login and a card saved
// from Murmur are filled into real pages by the agent's browser, a card for
// any website into the frame a checkout keeps its card fields in.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { QueryClient } from '@tanstack/react-query'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { composeSoul, createAgent } from '@/state/agents'
import { approvalText } from '@/features/chat/approval-text'
import { readVault, readVaultList, vaultActions } from '@/state/vault'
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

  it('keeps a card for any website, and moves it to one website and back', async ({ skip }) => {
    // A Hermes from before cards for any website keeps each card to one site, and Murmur offers no switch.
    if (!(await readVaultList('default')).anySite) return skip()
    const id = await vault.add({ ...card, site: '', anySite: true })
    const find = async () => (await readVault('default')).find((e) => e.id === id)!
    expect(await find()).toMatchObject({ kind: 'payment', label: 'Visa •••• 4242', anySite: true, origin: undefined, usedOn: [] })

    await vault.moveCard(await find(), { site: 'www.bestbuy.com' })
    expect(await find()).toMatchObject({ anySite: false, origin: 'https://www.bestbuy.com' })
    await vault.moveCard(await find(), { anySite: true })
    expect(await find()).toMatchObject({ anySite: true, origin: undefined })
    // Moving it is the same card throughout: nothing saved changes.
    expect((await stored('default'))[id]).toEqual({ card_number: '4242424242424242', exp_month: '12', exp_year: '2030', cvc: '123', cardholder_name: 'Ada Lovelace' })
    await vault.remove(await find())
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
  // One chat for both tests. Once a second agent exists, Hermes 0.22.5 starts a later chat's browser apart
  // from the one its fills reach, so a fill in a new chat finds no page.
  let chat: { socket: Socket; runtime: string } | undefined
  afterAll(() => chat?.socket.close())
  const open = async () => {
    if (chat) return chat
    // A payment card is filled only after the person says so.
    const socket = await connect((r) => (r.method === 'approval' ? { choice: 'once' } : undefined))
    return (chat = { socket, runtime: (await newChat(socket)).runtime })
  }

  // The vault rides with Hermes's browser; a Hermes without one has nothing to fill.
  const hasBrowser = async () => {
    const check = 'import model_tools\nfrom tools.registry import registry\ne = registry._tools.get("browser_vault")\nprint(bool(e and e.check_fn()))'
    return (await inHermes('python', '-c', check)).stdout.trim() === 'True'
  }
  const pages = {
    'login.html': '<form><input name=username autocomplete=username><input id=p type=password autocomplete=current-password><button>Sign in</button></form>',
    'checkout.html': '<form><input autocomplete=cc-name><input autocomplete=cc-number><input autocomplete=cc-exp><input autocomplete=cc-csc><button>Pay</button></form>',
    // A checkout that keeps the card's own fields in a frame, the way Stripe and Adyen do.
    'pay.html': '<form><input autocomplete=cc-name><iframe src=card.html></iframe><button>Pay</button></form>',
    'card.html': '<input autocomplete=cc-number><input autocomplete=cc-exp><input autocomplete=cc-csc>',
  }
  /** The pages, served on a port of the Hermes container's own: one origin per port. */
  async function serve(port: number) {
    for (const [file, html] of Object.entries(pages))
      await inHermes('sh', '-c', `mkdir -p /tmp/site && printf '%s' "$0" > /tmp/site/${file}`, html)
    await run('docker', ['exec', '-d', '-w', '/tmp/site', inject('hermes').container, 'python', '-m', 'http.server', String(port), '--bind', '127.0.0.1'])
    return `http://127.0.0.1:${port}`
  }
  const page = (url: string) => ({ name: 'browser_exec', args: { code: `new_tab("${url}"); wait_for_load()` } })
  const goto = (url: string) => ({ name: 'browser_exec', args: { code: `goto_url("${url}"); wait_for_load()` } })
  const fill = (handle: string) => ({ name: 'tool_call', args: { calls: [{ name: 'browser_vault', arguments: { action: 'fill', handle } }] } })
  const results = (socket: Socket, runtime: string) =>
    socket
      .of(runtime)
      .filter((e) => e.type === 'tool.complete')
      .map((e) => (e.payload as { name: string; result: Record<string, unknown> }))
  const typed = (socket: Socket, runtime: string) =>
    results(socket, runtime)
      .filter((r) => r.name === 'browser_exec' && /^\d/.test(String(r.result.output)))
      .map((r) => String(r.result.output).trim())

  it('fills a sign-in page and a checkout from what Murmur saved', async ({ skip }) => {
    if (!(await hasBrowser())) return skip()
    const site = await serve(8765)
    const loginId = await vault.add({ kind: 'login', site, identifier: 'tester', password: 'pw-from-murmur' })
    const cardId = await vault.add({ ...card, site, name: 'Ada' })

    const { socket, runtime } = await open()
    const lengths = { name: 'browser_exec', args: { code: 'print(js("[...document.querySelectorAll(\'input\')].map(i => i.value.length).join(\',\')"))' } }

    await turn(socket, runtime, `Sign in ${toolsTag([page(`${site}/login.html`), fill(loginId), lengths])}`)
    await turn(socket, runtime, `Pay ${toolsTag([page(`${site}/checkout.html`), fill(cardId), lengths])}`)

    const fills = results(socket, runtime).filter((r) => r.name === 'browser_vault').map((r) => r.result)
    expect(fills[0]).toMatchObject({ success: true, filled_fields: 1, kind: 'login', origin: site })
    expect(fills[1]).toMatchObject({ success: true, kind: 'payment', origin: site })
    // The password went in, and the username was left for the agent to type.
    expect(typed(socket, runtime)[0]).toBe('0,14')
    // Name, number, MM/YY and the code. (Read back as lengths: Hermes blanks out any secret the browser echoes.)
    expect(typed(socket, runtime)[1]).toBe('3,16,5,3')
    expect(socket.requests.find((r) => r.method === 'approval')?.params).toMatchObject({ pattern_keys: ['mcp_elicitation'] })
  })

  it('pays with a card for any website, into the checkout’s card frame, and keeps where it was used', async ({ skip }) => {
    if (!(await hasBrowser()) || !(await readVaultList('default')).anySite) return skip()
    // A shop no card has been used on.
    const site = await serve(8766)
    const id = await vault.add({ ...card, site: '', anySite: true, name: 'Ada' })

    const { socket, runtime } = await open()
    const lengths = {
      name: 'browser_exec',
      args: { code: 'print(js("[document, document.querySelector(\'iframe\').contentDocument].map(d => [...d.querySelectorAll(\'input\')].map(i => i.value.length).join(\',\')).join(\' | \')"))' },
    }
    // In the last checkout's tab: with two shops' card forms open, Hermes won't guess which to fill.
    await turn(socket, runtime, `Pay ${toolsTag([goto(`${site}/pay.html`), fill(id), lengths])}`)

    const filled = results(socket, runtime).findLast((r) => r.name === 'browser_vault')?.result
    expect(filled).toMatchObject({ success: true, filled_fields: 4, kind: 'payment', origin: site, frames: [site] })
    // The name on the page, and the number, MM/YY and code in its frame.
    expect(typed(socket, runtime).at(-1)).toBe('3 | 16,5,3')

    // The person is asked about this card on this site, and told it's the first time here.
    const asked = socket.requests.findLast((r) => r.method === 'approval')!.params as Record<string, unknown>
    expect(asked).toMatchObject({ pattern_keys: ['mcp_elicitation'], payment: { card: 'Visa •••• 4242', origin: site, any_site: true, first_time: true } })
    const text = approvalText({
      who: 'Atlas',
      command: asked.command as string,
      description: asked.description as string,
      patternKeys: asked.pattern_keys as string[],
      payment: asked.payment,
    })
    expect(text).toMatchObject({ title: 'Atlas wants to pay with your card', payment: { card: 'Visa •••• 4242', host: '127.0.0.1:8766', first: true } })

    // And Passwords shows where it went.
    const entry = (await readVault('default')).find((e) => e.id === id)!
    expect(entry.usedOn).toEqual([{ origin: site, at: expect.any(Date) }])
  })
})
