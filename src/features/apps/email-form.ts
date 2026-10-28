// The email form's rules, apart from how it looks: the shape of each
// provider's app password, which field a failed sign-in points at, and the
// servers an address at its own domain probably uses.

import {
  defaultPort,
  MAIL_PROVIDERS,
  parsePort,
  type MailFailureKind,
  type MailFailureWhere,
  type MailProviderId,
  type MailSecurity,
  type MailServer,
} from '@/state/mail'
import { EMAIL_ICON } from './app-icon'

export type KnownProvider = Exclude<MailProviderId, 'other'>

/** The icon an account shows: its provider's mark, or the plain envelope. */
export const mailIcon = (provider: MailProviderId) => (provider === 'other' ? EMAIL_ICON : provider)

/** Who makes the app password, in "Google gives Atlas a password of its own". */
export const MAKER: Record<KnownProvider, string> = {
  gmail: 'Google',
  icloud: 'Apple',
  fastmail: 'Fastmail',
  yahoo: 'Yahoo',
}

/** What the button that opens the provider's app password page says. */
export const OPEN_LABEL: Record<KnownProvider, string> = {
  gmail: 'Open Google',
  icloud: 'Open Apple Account',
  fastmail: 'Open Fastmail',
  yahoo: 'Open Yahoo',
}

export const ADDRESS_HINT: Record<MailProviderId, string> = {
  gmail: 'you@gmail.com',
  icloud: 'you@icloud.com',
  fastmail: 'you@fastmail.com',
  yahoo: 'you@yahoo.com',
  other: 'you@example.com',
}

// ── App passwords ───────────────────────────────────────────────────────────

/**
 * How a provider shows its app passwords: sixteen characters in four groups
 * of four (Google spaces them, Apple joins them with dashes). `exact`: never
 * anything else, so the form can say so before anyone signs in.
 */
export type CodeShape = { join: ' ' | '-'; chars: RegExp; exact: boolean; wrong: string }

export const CODE_SHAPES: Record<KnownProvider, CodeShape> = {
  gmail: { join: ' ', chars: /^[a-z]+$/i, exact: true, wrong: 'Google’s app passwords are 16 letters.' },
  icloud: { join: '-', chars: /^[a-z]+$/i, exact: true, wrong: 'Apple’s app-specific passwords are 16 letters.' },
  fastmail: { join: ' ', chars: /^[a-z0-9]+$/i, exact: false, wrong: 'Fastmail’s app passwords are letters and numbers.' },
  yahoo: { join: ' ', chars: /^[a-z]+$/i, exact: false, wrong: 'Yahoo’s app passwords are letters.' },
}

export const CODE_LENGTH = 16

/** The characters of an app password as typed or pasted, without the spaces and dashes between its groups. */
export const codeChars = (raw: string) => raw.replace(/[\s-]+/g, '')

/** Its four groups, for the boxes ('' for one not reached yet). */
export const codeGroups = (raw: string) => [0, 1, 2, 3].map((i) => codeChars(raw).slice(i * 4, i * 4 + 4))

export type CodeState = 'empty' | 'typing' | 'ready' | 'wrong'

/** Where an app password stands: still being typed, ready to try, or not one this provider makes. */
export function codeState(provider: KnownProvider, raw: string): CodeState {
  const shape = CODE_SHAPES[provider]
  const chars = codeChars(raw)
  if (!chars) return 'empty'
  if (!shape.chars.test(chars)) return 'wrong'
  if (shape.exact) return chars.length === CODE_LENGTH ? 'ready' : chars.length > CODE_LENGTH ? 'wrong' : 'typing'
  return chars.length >= 8 ? 'ready' : 'typing'
}

/** The password as it goes to the provider: as it shows them (Apple's with its dashes), else as typed. */
export function codeValue(provider: KnownProvider, raw: string) {
  const chars = codeChars(raw)
  if (CODE_SHAPES[provider].join === '-' && chars.length === CODE_LENGTH)
    return codeGroups(raw).join('-')
  return chars
}

// ── When a sign-in fails ────────────────────────────────────────────────────

export type MailField = 'address' | 'password' | 'incoming' | 'outgoing'

/**
 * The field a failed sign-in points at, so the form can mark it and put the
 * words under it. Null: nothing the person typed (the server, the network),
 * so the words go under the button.
 */
export function fieldFor(
  provider: MailProviderId,
  kind: MailFailureKind | 'save',
  where: MailFailureWhere | null,
  filled: { address: boolean; password: boolean },
): MailField | null {
  const other = provider === 'other'
  switch (kind) {
    case 'incomplete':
      return !filled.address ? 'address' : !filled.password ? 'password' : other ? 'incoming' : null
    case 'wrong_password':
    case 'app_password':
      return other && where === 'outgoing' ? 'outgoing' : 'password'
    case 'unreachable':
    case 'tls':
      return other ? (where === 'outgoing' ? 'outgoing' : 'incoming') : null
    default:
      return null
  }
}

// ── Another account's servers ───────────────────────────────────────────────

export type ServerDraft = { host: string; port: string; security: MailSecurity }

/** The servers most mail services at a domain use, as a first guess for the advanced fields. */
export function guessServers(address: string): { incoming: ServerDraft; outgoing: ServerDraft } {
  const domain = address.trim().toLowerCase().split('@')[1]?.replace(/[^a-z0-9.-]/g, '') ?? ''
  return {
    incoming: { host: domain ? `imap.${domain}` : '', port: '993', security: 'ssl' },
    outgoing: { host: domain ? `smtp.${domain}` : '', port: '465', security: 'ssl' },
  }
}

/** A server once its security changes: the port follows, unless the person set one of their own. */
export function withSecurity(kind: 'incoming' | 'outgoing', server: ServerDraft, security: MailSecurity): ServerDraft {
  const usual = String(defaultPort(kind, server.security))
  return { ...server, security, port: !server.port.trim() || server.port.trim() === usual ? String(defaultPort(kind, security)) : server.port }
}

/** A server from the advanced fields, or null when it isn't complete. */
export function serverOf(draft: ServerDraft): MailServer | null {
  const port = parsePort(draft.port)
  const host = draft.host.trim()
  return host && port ? { host, port, security: draft.security } : null
}

/** What the person needs to see about a provider before they start, if anything. */
export const providerNote = (provider: MailProviderId) => MAIL_PROVIDERS[provider].note
