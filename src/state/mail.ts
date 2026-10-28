// Email for an agent: one account at Gmail, iCloud Mail, Fastmail, Yahoo Mail
// or anywhere else, connected with an app password. The agent can search,
// read and draft; it sends only after the person approves the exact message in
// the chat. Mail goes straight between the provider and this Hermes.
//
// It runs in Hermes as the `murmur-mail` plugin that Umbrel's Hermes image
// bundles (getumbrel/hermes-agent-umbrel, umbrel-context/plugins/murmur-mail).
// A Hermes without it answers 404 to the plugin's status route: then there's
// no email to offer, and fetchMailStatus says so with null.
//
// Each agent has its own account, kept in that agent's own .env (the keys
// below), written and removed here through Hermes's /api/env. The plugin
// reads them through Hermes's profile scope, checks an account by signing in,
// and never hands the password back. Like vault.ts, a password goes straight
// from the form into the requests that need it: nothing here keeps it.
//
// Hermes copies the main agent's .env into every agent it makes, so the keys
// also name the agent they belong to (MURMUR_MAIL_AGENT). The plugin ignores a
// copy in another agent, and fetchMailStatus clears such a copy away.

import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'

export const MAIL_PLUGIN = 'murmur-mail'

export {
  isMailTool,
  isSendApproval,
  MAIL_TOOLS,
  readMailResult,
  readSendApproval,
  SEND_APPROVAL_PREFIX,
  type MailTool,
  type SendApproval,
} from './mail-chat'

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`
const route = (path: string, profile: string) => `/api/plugins/${MAIL_PLUGIN}/${path}?${q(profile)}`

// ── Providers ───────────────────────────────────────────────────────────────

export type MailProviderId = 'gmail' | 'icloud' | 'fastmail' | 'yahoo' | 'other'
export type MailSecurity = 'ssl' | 'starttls' | 'none'
export type MailServer = { host: string; port: number; security: MailSecurity }

export type MailProvider = {
  id: MailProviderId
  name: string
  /** Addresses at these domains are this provider's. */
  domains: string[]
  /** Where mail comes in and goes out (null for another account: the person says). */
  incoming: MailServer | null
  outgoing: MailServer | null
  /** The page where the provider makes app passwords. */
  appPasswordUrl: string | null
  /** What that page is called there, and what it takes first, for the steps the sheet shows. */
  appPasswordSteps: string[]
  /** Something worth knowing before starting, if anything. */
  note?: string
  /** The provider's own mail on the web (see mailWebUrl). */
  webUrl: string | null
  /** Whether a copy of sent mail has to be filed in Sent (Gmail and Yahoo file it themselves). */
  saveSent: boolean
}

export const MAIL_PROVIDERS: Record<MailProviderId, MailProvider> = {
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    incoming: { host: 'imap.gmail.com', port: 993, security: 'ssl' },
    outgoing: { host: 'smtp.gmail.com', port: 465, security: 'ssl' },
    // support.google.com/accounts/answer/185833
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    appPasswordSteps: [
      'Open App passwords in your Google Account.',
      'Name it Murmur and choose Create.',
      'Copy the 16-letter password and paste it here.',
    ],
    note: 'App passwords need 2-Step Verification. Some work and school accounts don’t offer them.',
    webUrl: 'https://mail.google.com/mail/',
    saveSent: false,
  },
  icloud: {
    id: 'icloud',
    name: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    incoming: { host: 'imap.mail.me.com', port: 993, security: 'ssl' },
    outgoing: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
    // support.apple.com/102654
    appPasswordUrl: 'https://account.apple.com/',
    appPasswordSteps: [
      'Sign in at account.apple.com.',
      'In Sign-In and Security, choose App-Specific Passwords.',
      'Make one called Murmur, then copy it here.',
    ],
    note: 'App-specific passwords need two-factor authentication on your Apple Account.',
    webUrl: 'https://www.icloud.com/mail/',
    saveSent: true,
  },
  fastmail: {
    id: 'fastmail',
    name: 'Fastmail',
    domains: ['fastmail.com', 'fastmail.fm', 'fastmail.cn', 'fastmail.co.uk', 'fastmail.com.au', 'fastmail.de', 'fastmail.es', 'fastmail.in', 'fastmail.jp', 'fastmail.net', 'fastmail.org', 'fastmail.to', 'fastmail.us', 'messagingengine.com'],
    incoming: { host: 'imap.fastmail.com', port: 993, security: 'ssl' },
    outgoing: { host: 'smtp.fastmail.com', port: 465, security: 'ssl' },
    // fastmail.help/hc/en-us/articles/360058752854
    appPasswordUrl: 'https://app.fastmail.com/settings/security',
    appPasswordSteps: [
      'Open Privacy & Security in Fastmail’s settings.',
      'Choose Manage app passwords and access, then New app password.',
      'Keep Mail, Contacts & Calendars, generate it, and copy it here.',
    ],
    note: 'Fastmail’s Basic plan doesn’t include app passwords.',
    webUrl: 'https://app.fastmail.com/mail/',
    saveSent: true,
  },
  yahoo: {
    id: 'yahoo',
    name: 'Yahoo Mail',
    domains: ['yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.com.au', 'yahoo.co.in', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.it', 'yahoo.co.jp', 'yahoo.com.br', 'yahoo.com.mx', 'yahoo.com.sg', 'yahoo.co.nz'],
    incoming: { host: 'imap.mail.yahoo.com', port: 993, security: 'ssl' },
    outgoing: { host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl' },
    // help.yahoo.com/kb/SLN15241.html
    appPasswordUrl: 'https://login.yahoo.com/account/security',
    appPasswordSteps: [
      'Open Account Security in your Yahoo account.',
      'Under External connections, choose Create app password.',
      'Name it Murmur, generate it, and copy it here.',
    ],
    webUrl: 'https://mail.yahoo.com/',
    saveSent: false,
  },
  other: {
    id: 'other',
    name: 'Another account',
    domains: [],
    incoming: null,
    outgoing: null,
    appPasswordUrl: null,
    appPasswordSteps: [],
    webUrl: null,
    saveSent: true,
  },
}

/** The order the sheet offers them in. */
export const MAIL_PROVIDER_ORDER: MailProviderId[] = ['gmail', 'icloud', 'fastmail', 'yahoo', 'other']

const domainOf = (address: string) => address.trim().toLowerCase().split('@').at(-1) ?? ''

/** Whose an address is, from its domain: 'other' for a work, school or own domain. */
export function providerFor(address: string): MailProviderId {
  const domain = domainOf(address)
  if (!domain || !address.includes('@')) return 'other'
  for (const id of MAIL_PROVIDER_ORDER) {
    if (MAIL_PROVIDERS[id].domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return id
  }
  return 'other'
}

/**
 * The account's mail on the web, for "Open in Gmail" after a draft: Gmail
 * opens the account's own Drafts (signed in to several Google accounts, it
 * picks this one); the others open their mail. Null for another account.
 */
export function mailWebUrl(account: Pick<MailAccount, 'address' | 'provider'>, at: 'inbox' | 'drafts' = 'inbox') {
  const web = MAIL_PROVIDERS[account.provider].webUrl
  if (!web) return null
  if (account.provider !== 'gmail') return web
  return `${web}?authuser=${encodeURIComponent(account.address)}${at === 'drafts' ? '#drafts' : '#inbox'}`
}

export const looksLikeAddress = (address: string) => /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/.test(address.trim())

/**
 * An app password as pasted. Gmail shows its 16 letters in groups of four and
 * iCloud joins its groups with dashes; spaces never belong in one, so they go
 * for the four providers. Another account's password is kept as typed, apart
 * from the ends.
 */
export function cleanAppPassword(provider: MailProviderId, raw: string) {
  return provider === 'other' ? raw.replace(/^[\r\n\t ]+|[\r\n\t ]+$/g, '') : raw.replace(/\s+/g, '')
}

/** A port typed into the advanced fields, or null when it isn't one. */
export function parsePort(text: string): number | null {
  const n = Number(text.trim())
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null
}

/** The usual port for a security choice, for when the person changes it. */
export const defaultPort = (kind: 'incoming' | 'outgoing', security: MailSecurity) =>
  kind === 'incoming' ? (security === 'ssl' ? 993 : 143) : security === 'ssl' ? 465 : security === 'starttls' ? 587 : 25

// ── The agent's account ─────────────────────────────────────────────────────

export type MailAccount = {
  address: string
  /** The name mail goes out under ('' for the address alone). */
  name: string
  /** A sign-in name other than the address ('' when it's the address). */
  username: string
  provider: MailProviderId
  incoming: MailServer
  outgoing: MailServer
  saveSent: boolean
}

export type MailStatus = {
  version: string
  /** The plugin is switched on for this agent (its tools need it). connectMail switches it on. */
  enabled: boolean
  /**
   * The person switched the agent's email off (setMailEnabled): its email
   * toolset is off, so its chats have no email tools, and the account stays.
   */
  off: boolean
  /** The agent has an account. */
  configured: boolean
  account: MailAccount | null
}

type WireServer = { host: string; port: number; security: MailSecurity }
type WireAccount = {
  address: string
  name: string
  username: string
  provider: string
  imap: WireServer
  smtp: WireServer
  save_sent: boolean
}
type WireStatus = {
  plugin: string
  version: string
  enabled: boolean
  configured: boolean
  account: WireAccount | null
  missing: string[]
  inherited?: boolean
}

const isProvider = (id: string): id is MailProviderId => id in MAIL_PROVIDERS

export function toAccount(wire: WireAccount): MailAccount {
  return {
    address: wire.address,
    name: wire.name ?? '',
    username: wire.username ?? '',
    provider: isProvider(wire.provider) ? wire.provider : providerFor(wire.address),
    incoming: { ...wire.imap },
    outgoing: { ...wire.smtp },
    saveSent: wire.save_sent !== false,
  }
}

export const mailKey = (profile: string) => ['mail', profile] as const
export const mailHealthKey = (profile: string) => ['mail-health', profile] as const

/**
 * The agent's email, or null when this Hermes has no email to offer (no Email
 * tile). A copy of another agent's account found in this agent's .env is
 * cleared away on the way (see the top of this file).
 */
export async function fetchMailStatus(profile: string): Promise<MailStatus | null> {
  let wire: WireStatus
  try {
    wire = await api.get<WireStatus>(route('status', profile))
  } catch (e) {
    if (e instanceof HermesError && e.status === 404) return null
    throw e
  }
  if (wire?.plugin !== MAIL_PLUGIN) return null
  if (wire.inherited) await clearMailKeys(profile).catch(() => {})
  const off = await mailToolsOff(profile).catch(() => false)
  return {
    version: wire.version,
    enabled: !!wire.enabled,
    off,
    configured: !!wire.configured,
    account: wire.account ? toAccount(wire.account) : null,
  }
}

// ── On and off ──────────────────────────────────────────────────────────────

/** The plugin's toolset: what Murmur switches off to take an agent's email tools away. */
export const MAIL_TOOLSET = 'email'

const toolsetList = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : typeof value === 'string' && value.trim() ? [value.trim()] : []

const disabledToolsets = async (profile: string) =>
  toolsetList(
    (await api.get<{ agent?: { disabled_toolsets?: unknown } }>(`/api/config?${q(profile)}&include_defaults=false`))?.agent
      ?.disabled_toolsets,
  )

const mailToolsOff = async (profile: string) => (await disabledToolsets(profile)).includes(MAIL_TOOLSET)

/**
 * Puts the agent's email toolset on or off in its own config (agent.disabled_toolsets,
 * Hermes's per-agent switch for a set of tools), leaving its other entries be.
 * Not the plugin's own switch: Hermes refuses a plugin's routes for an agent that
 * has it switched off, and Murmur couldn't read the account any more.
 */
async function switchMailTools(profile: string, on: boolean) {
  const list = await disabledToolsets(profile)
  const next = on ? list.filter((t) => t !== MAIL_TOOLSET) : list.includes(MAIL_TOOLSET) ? list : [...list, MAIL_TOOLSET]
  if (next.length === list.length) return
  // PUT deep-merges into the file; the list is replaced whole.
  await api.put(`/api/config?${q(profile)}`, { config: { agent: { disabled_toolsets: next } } })
}

/** useQuery over fetchMailStatus: `data === null` means no email on this Hermes. */
export function useMailStatus(profile: string, enabled = true) {
  return useQuery({
    queryKey: mailKey(profile),
    enabled,
    queryFn: () => fetchMailStatus(profile),
    staleTime: 60_000,
  })
}

// ── Checking ────────────────────────────────────────────────────────────────

export type MailFailureKind =
  /** Something the account needs wasn't given. */
  | 'incomplete'
  /** The password was turned down. */
  | 'wrong_password'
  /** The provider said it wants an app password, not the account's own. */
  | 'app_password'
  /** The server couldn't be reached (a wrong name or port, or the network). */
  | 'unreachable'
  /** No secure connection: an untrusted certificate, or the wrong security for the port. */
  | 'tls'
  | 'unknown'

/** Where it went wrong: where mail comes in (IMAP) or goes out (SMTP). */
export type MailFailureWhere = 'incoming' | 'outgoing'

/** One of the newest messages in the inbox, shown as proof the account works. */
export type MailProof = { fromName: string; fromAddress: string; subject: string; date: Date | null }

export type MailCheck =
  | { ok: true; account: MailAccount; newest: MailProof[] }
  | { ok: false; kind: MailFailureKind; where: MailFailureWhere | null; detail: string }

type WireCheck =
  | { ok: true; account: WireAccount; newest: { from_name: string; from_address: string; subject: string; date: string }[] }
  | { ok: false; error: { kind: string; where: string; detail: string } }

const KINDS = new Set<MailFailureKind>(['incomplete', 'wrong_password', 'app_password', 'unreachable', 'tls', 'unknown'])

export function toCheck(wire: WireCheck): MailCheck {
  if (wire.ok) {
    return {
      ok: true,
      account: toAccount(wire.account),
      newest: wire.newest.map((m) => {
        const date = m.date ? new Date(m.date) : null
        return { fromName: m.from_name, fromAddress: m.from_address, subject: m.subject, date: date && !Number.isNaN(+date) ? date : null }
      }),
    }
  }
  const kind = KINDS.has(wire.error.kind as MailFailureKind) ? (wire.error.kind as MailFailureKind) : 'unknown'
  const where = wire.error.where === 'imap' ? 'incoming' : wire.error.where === 'smtp' ? 'outgoing' : null
  return { ok: false, kind, where, detail: wire.error.detail ?? '' }
}

/** What the plugin's check takes: a whole account, or (without `address`) what to change about the saved one. */
export type CheckBody = {
  address?: string
  password?: string
  username?: string
  name?: string
  provider?: MailProviderId
  imap_host?: string
  imap_port?: number
  imap_security?: MailSecurity
  smtp_host?: string
  smtp_port?: number
  smtp_security?: MailSecurity
  save_sent?: boolean
}

/** Signs in to the account (the saved one, or `body`'s) and brings back the newest three messages. */
export async function checkMail(profile: string, body: CheckBody = {}): Promise<MailCheck> {
  return toCheck(await api.post<WireCheck>(route('check', profile), body))
}

/** How a connected account is doing: ok, needs its password again, or can't be reached. */
export type MailHealth = 'ok' | 'signin' | 'down'

export const healthOf = (check: MailCheck): MailHealth =>
  check.ok ? 'ok' : check.kind === 'wrong_password' || check.kind === 'app_password' ? 'signin' : 'down'

/**
 * A live check of a connected account, at most every ten minutes. Each is a
 * real sign-in, so it runs only while asked for (the sheet is open) and never
 * retries on its own: providers lock out bursts of failed sign-ins.
 */
export function useMailHealth(profile: string, enabled = true) {
  return useQuery({
    queryKey: mailHealthKey(profile),
    enabled,
    queryFn: async () => healthOf(await checkMail(profile)),
    staleTime: 10 * 60_000,
    retry: false,
  })
}

// ── Words ───────────────────────────────────────────────────────────────────

/** What went wrong, in a sentence for the person. */
export function mailErrorText(provider: MailProviderId, kind: MailFailureKind, where: MailFailureWhere | null = null) {
  const p = MAIL_PROVIDERS[provider]
  const known = provider !== 'other'
  switch (kind) {
    case 'incomplete':
      return known ? 'Add your address and app password.' : 'Add your address, password and both servers.'
    case 'app_password':
      return `${p.name} wants an app password here, not your usual password.`
    case 'wrong_password':
      if (known) return `${p.name} didn’t accept that password. Check it’s an app password, not your usual one.`
      return where === 'outgoing'
        ? 'Mail came in, but sending didn’t sign in. Check the outgoing server’s settings.'
        : 'That address and password didn’t sign in. Check them and try again.'
    case 'unreachable':
      if (known) return `Couldn’t reach ${p.name}. Check your connection and try again.`
      return where === 'outgoing'
        ? 'Couldn’t reach the outgoing server. Check its name and port.'
        : 'Couldn’t reach the incoming server. Check its name and port.'
    case 'tls':
      if (known) return `Couldn’t connect securely to ${p.name}. Try again in a moment.`
      return `Couldn’t connect securely to the ${where === 'outgoing' ? 'outgoing' : 'incoming'} server. Check its security setting and port.`
    default:
      return known ? `${p.name} didn’t let your agent in. Try again in a moment.` : 'Couldn’t connect to that account. Check its settings and try again.'
  }
}

/** A connect or password change that didn't go through, with the words to show. */
export class MailError extends Error {
  kind: MailFailureKind | 'save'
  where: MailFailureWhere | null
  constructor(message: string, kind: MailFailureKind | 'save', where: MailFailureWhere | null = null) {
    super(message)
    this.kind = kind
    this.where = where
  }
}

// ── Connecting ──────────────────────────────────────────────────────────────

const ENV = 'MURMUR_MAIL_'
/** Every key the account keeps in the agent's .env. */
export const MAIL_ENV_KEYS = [
  'ADDRESS',
  'PASSWORD',
  'IMAP_HOST',
  'IMAP_PORT',
  'IMAP_SECURITY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURITY',
  'USERNAME',
  'NAME',
  'PROVIDER',
  'SAVE_SENT',
  'AGENT',
].map((k) => ENV + k)

export type MailConnectInput = {
  provider: MailProviderId
  address: string
  /** The app password, as pasted. */
  password: string
  /** The name mail goes out under. */
  name?: string
  /** Another account: a sign-in name other than the address. */
  username?: string
  /** Another account: its servers (the four providers' are known). */
  incoming?: MailServer
  outgoing?: MailServer
}

/** The whole account to check and save, from what the person gave. */
export function accountFor(input: MailConnectInput): CheckBody {
  const p = MAIL_PROVIDERS[input.provider]
  const incoming = p.incoming ?? input.incoming
  const outgoing = p.outgoing ?? input.outgoing
  const address = input.address.trim()
  const username = input.provider === 'other' ? (input.username ?? '').trim() : ''
  return {
    address,
    password: cleanAppPassword(input.provider, input.password),
    ...(username && username.toLowerCase() !== address.toLowerCase() ? { username } : {}),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    provider: input.provider,
    imap_host: incoming?.host.trim(),
    imap_port: incoming?.port,
    imap_security: incoming?.security,
    smtp_host: outgoing?.host.trim(),
    smtp_port: outgoing?.port,
    smtp_security: outgoing?.security,
    save_sent: p.saveSent,
  }
}

/** The account as .env keys and values for `profile` (values Hermes stores as text). */
export function envFor(body: CheckBody, profile: string): Record<string, string> {
  const out: Record<string, string> = {}
  const set = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === '') return
    out[ENV + key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  }
  // First: from the first key on, what's there is this agent's (never taken for a copy and cleared).
  set('AGENT', profile)
  set('ADDRESS', body.address)
  set('IMAP_HOST', body.imap_host)
  set('IMAP_PORT', body.imap_port)
  set('IMAP_SECURITY', body.imap_security)
  set('SMTP_HOST', body.smtp_host)
  set('SMTP_PORT', body.smtp_port)
  set('SMTP_SECURITY', body.smtp_security)
  set('USERNAME', body.username)
  set('NAME', body.name)
  set('PROVIDER', body.provider)
  set('SAVE_SENT', body.save_sent)
  // Last, so a save cut short leaves no password behind settings that never checked out.
  set('PASSWORD', body.password)
  return out
}

/** The MURMUR_MAIL_ keys this agent's .env has. */
async function savedKeys(profile: string): Promise<string[]> {
  const env = await api.get<Record<string, { is_set?: boolean }>>(`/api/env?${q(profile)}`)
  return MAIL_ENV_KEYS.filter((k) => env?.[k]?.is_set)
}

const putEnv = (profile: string, key: string, value: string) => api.put(`/api/env?${q(profile)}`, { key, value, profile })

async function deleteEnv(profile: string, key: string) {
  try {
    await api.delete(`/api/env?${q(profile)}`, { key, profile })
  } catch (e) {
    if (!(e instanceof HermesError && e.status === 404)) throw e
  }
}

/**
 * Switches the plugin on for the agent if it isn't, the way Hermes's own
 * plugin switch does, so its tools load for the agent's next chat. Umbrel's
 * image switches it on for every agent when Hermes starts; this covers agents
 * made since.
 */
export async function ensureMailPlugin(profile: string, status?: MailStatus | null) {
  const current = status === undefined ? await fetchMailStatus(profile) : status
  if (!current || current.enabled) return
  await rpc('plugins.manage', { action: 'toggle', key: MAIL_PLUGIN, enable: true, profile })
}

/**
 * Switches the agent's email on or off, keeping its account: its next chat
 * has the email tools, or doesn't (chats already open keep what they started
 * with). Hermes notices because the agent's config changed.
 */
export async function setMailEnabled(qc: QueryClient, profile: string, enabled: boolean) {
  const before = qc.getQueryData<MailStatus | null>(mailKey(profile))
  qc.setQueryData<MailStatus | null>(mailKey(profile), (s) => (s ? { ...s, off: !enabled } : s))
  try {
    await switchMailTools(profile, enabled)
    if (enabled) await ensureMailPlugin(profile)
  } catch (e) {
    qc.setQueryData(mailKey(profile), before)
    throw e
  } finally {
    void qc.invalidateQueries({ queryKey: mailKey(profile) })
  }
}

/**
 * Records which account the agent's email uses in its config (the plugin's
 * own settings), '' once there's none. Hermes keeps each agent's list of tools
 * until its config changes, so this is also what brings the email tools to the
 * agent's next chat, or takes them away, without waiting for a restart.
 */
const recordAccount = (profile: string, address: string) =>
  api.put(`/api/config?${q(profile)}`, { config: { plugins: { entries: { [MAIL_PLUGIN]: { settings: { account: address } } } } } })

const refresh = (qc: QueryClient, profile: string) =>
  Promise.all([qc.invalidateQueries({ queryKey: mailKey(profile) }), qc.invalidateQueries({ queryKey: mailHealthKey(profile) })])

/**
 * Connects an email account to the agent: signs in to it first (nothing is
 * saved if that fails), then saves it in the agent's .env, replacing an
 * account it had, and switches the plugin on. Resolves with the three newest
 * messages as proof; throws MailError with the words to show.
 */
export async function connectMail(qc: QueryClient, profile: string, input: MailConnectInput) {
  const body = accountFor(input)
  if (!looksLikeAddress(body.address ?? '')) throw new MailError('That doesn’t look like an email address.', 'incomplete')
  const check = await checkMail(profile, body)
  if (!check.ok) throw new MailError(mailErrorText(input.provider, check.kind, check.where), check.kind, check.where)
  const env = envFor(body, profile)
  try {
    // An earlier account's extras (a sign-in name, a sender name) mustn't stay with this one.
    for (const key of await savedKeys(profile)) if (!(key in env)) await deleteEnv(profile, key)
    for (const [key, value] of Object.entries(env)) await putEnv(profile, key, value)
    await ensureMailPlugin(profile)
    // Connecting is switching it on. (Not worth failing over: the sheet shows the switch as it stands.)
    await switchMailTools(profile, true).catch(() => {})
    await recordAccount(profile, body.address ?? '')
  } catch {
    // Half an account is no account: take it all away rather than leave it.
    for (const key of MAIL_ENV_KEYS) await deleteEnv(profile, key).catch(() => {})
    await refresh(qc, profile)
    throw new MailError('Couldn’t save the account. Try again.', 'save')
  }
  qc.setQueryData(mailHealthKey(profile), 'ok' satisfies MailHealth)
  await qc.invalidateQueries({ queryKey: mailKey(profile) })
  return { account: check.account, newest: check.newest }
}

/** Checks a new app password against the saved account, then keeps it. Throws MailError. */
export async function changeMailPassword(qc: QueryClient, profile: string, password: string) {
  const status = await fetchMailStatus(profile)
  if (!status?.account) throw new MailError('This agent has no email account yet.', 'incomplete')
  const clean = cleanAppPassword(status.account.provider, password)
  if (!clean) throw new MailError(mailErrorText(status.account.provider, 'incomplete'), 'incomplete')
  const check = await checkMail(profile, { password: clean })
  if (!check.ok) throw new MailError(mailErrorText(status.account.provider, check.kind, check.where), check.kind, check.where)
  try {
    await putEnv(profile, `${ENV}PASSWORD`, clean)
  } catch {
    throw new MailError('Couldn’t save the new password. Try again.', 'save')
  }
  qc.setQueryData(mailHealthKey(profile), 'ok' satisfies MailHealth)
  await qc.invalidateQueries({ queryKey: mailKey(profile) })
  return { account: check.account, newest: check.newest }
}

/**
 * Clears another agent's account out of this agent's .env: Hermes copies the
 * main agent's .env into each agent it makes. The plugin never uses the copy;
 * this keeps its password from lingering. Worth calling right after making an
 * agent; fetchMailStatus does it whenever it finds one.
 */
export async function forgetInheritedMail(profile: string) {
  const wire = await api.get<WireStatus>(route('status', profile)).catch(() => null)
  if (wire?.inherited) await clearMailKeys(profile)
}

async function clearMailKeys(profile: string) {
  for (const key of await savedKeys(profile)) await deleteEnv(profile, key)
}

/** Takes the account away from the agent, its .env keys with it. The agent's tools go with them. */
export async function disconnectMail(qc: QueryClient, profile: string) {
  qc.setQueryData<MailStatus | null>(mailKey(profile), (s) => (s ? { ...s, configured: false, account: null } : s))
  try {
    // Every key, even ones the listing missed: a password must never be left behind.
    const keys = new Set([...(await savedKeys(profile).catch(() => MAIL_ENV_KEYS)), `${ENV}PASSWORD`])
    for (const key of keys) await deleteEnv(profile, key)
    await recordAccount(profile, '')
  } finally {
    qc.removeQueries({ queryKey: mailHealthKey(profile) })
    void refresh(qc, profile)
  }
}
