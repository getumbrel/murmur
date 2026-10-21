// An agent's passwords: the logins, cards and addresses Hermes keeps in that
// agent's encrypted vault and types into pages for it. The agent works with
// handles; a password, card number or address never reaches it, the chat or
// this app's cache. Each agent has its own vault.
//
// Hermes lists metadata only, adds and removes. It has no edit and never
// hands a secret back, so a change is a new item taking the old one's place:
// added first, so nothing is lost if a step fails, then the old one goes.
// Hermes fills an item only on the exact site it was saved for, so every
// item here names one.
//
// Secrets go straight from a form's own state into one request. Nothing here
// keeps them: no query cache, no mutation cache (so no useMutation), no store.

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { rpc } from '@/hermes/gateway'
import type { VaultItem as WireItem } from '@/hermes/vendor/gateway-contract.generated'

export type VaultKind = 'login' | 'payment' | 'address'

export type VaultEntry = {
  id: string
  kind: VaultKind
  label: string
  /** The site it's used on: scheme://host[:port]. */
  origin?: string
  /** A login's email, phone or username. Not a secret: the agent types it itself. */
  identifier?: string
  /** A login with an authenticator key: Hermes makes its sign-in codes. */
  otp: boolean
  added?: Date
}

export type LoginInput = { kind: 'login'; site: string; identifier: string; password: string; otp?: string }
export type CardInput = {
  kind: 'payment'
  site: string
  number: string
  /** "MM / YY", as the field shows it. */
  expiry: string
  cvc: string
  name?: string
  postcode?: string
}
export type AddressInput = {
  kind: 'address'
  site: string
  line1: string
  line2?: string
  city: string
  state?: string
  postcode: string
  country: string
}
export type VaultInput = LoginInput | CardInput | AddressInput

export const vaultKey = (agentId: string) => ['vault', agentId] as const

const KINDS = new Set<string>(['login', 'payment', 'address'])

/**
 * Only Hermes's own vault: a password manager unlocked on a computer (1Password,
 * Bitwarden) lists its items here too, but those are managed in the manager.
 */
export function toEntries(items: WireItem[] | undefined): VaultEntry[] {
  return (items ?? [])
    .filter((item) => item.backend === 'local' && KINDS.has(item.kind))
    .map((item) => ({
      id: item.id,
      kind: item.kind as VaultKind,
      label: item.label,
      origin: item.origin ?? undefined,
      identifier: item.identifier ?? undefined,
      otp: !!item.has_otp,
      added: item.created_at ? new Date(item.created_at) : undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

/** The agent's items, fresh from Hermes. */
export async function readVault(agentId: string) {
  try {
    return toEntries((await rpc<{ items?: WireItem[] }>('vault.list', { profile: agentId })).items)
  } catch (error) {
    throw friendly(error, 'Hermes couldn’t open these passwords. Try again in a moment.')
  }
}

export function useVault(agentId: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: vaultKey(agentId),
    queryFn: () => readVault(agentId),
    enabled,
    // The agent can save a login mid-chat, so a sheet opening reads it fresh.
    staleTime: 5_000,
  })
}

// ── Saving ──────────────────────────────────────────────────────────────────

/** What Hermes is sent for an input, or undefined while it isn't complete. */
export function toWire(input: VaultInput) {
  const origin = originOf(input.site)
  if (!origin) return undefined
  switch (input.kind) {
    case 'login': {
      const identifier = input.identifier.trim()
      if (!identifier || !input.password) return undefined
      const otp = input.otp?.trim()
      return {
        kind: 'login' as const,
        label: hostOf(origin),
        origin,
        secret: {
          identifier_type: identifierType(identifier),
          identifier,
          password: input.password,
          ...(otp && { otp_secret: otp }),
        },
      }
    }
    case 'payment': {
      const number = digitsOf(input.number)
      const expiry = parseExpiry(input.expiry)
      const cvc = digitsOf(input.cvc)
      if (!cardNumberOk(number) || !expiry || !cvcOk(cvc, number)) return undefined
      const name = input.name?.trim()
      const postcode = input.postcode?.trim()
      return {
        kind: 'payment' as const,
        label: cardLabel(number),
        origin,
        secret: {
          card_number: number,
          exp_month: expiry.month,
          exp_year: expiry.year,
          cvc,
          ...(name && { cardholder_name: name }),
          ...(postcode && { billing_postal_code: postcode }),
        },
      }
    }
    case 'address': {
      const [line1, city, postcode, country] = [input.line1, input.city, input.postcode, input.country].map((s) => s.trim())
      if (!line1 || !city || !postcode || !country) return undefined
      const line2 = input.line2?.trim()
      const state = input.state?.trim()
      return {
        kind: 'address' as const,
        label: line1,
        origin,
        secret: {
          address_line1: line1,
          ...(line2 && { address_line2: line2 }),
          city,
          ...(state && { state }),
          postal_code: postcode,
          country,
        },
      }
    }
  }
}

/** Hermes's errors, in words; ours (already human) pass through. */
export class VaultError extends Error {}

/** Hermes's "method not found": a Hermes from before the vault. */
const NO_METHOD = -32601
/** Hermes's vault failure (a field it refused, an unreadable vault file). */
const VAULT_FAILED = 5095

function friendly(error: unknown, failed = 'Hermes couldn’t save that. Check it and try again.'): VaultError {
  if (error instanceof VaultError) return error
  const { code, message = '' } = (error ?? {}) as { code?: number; message?: string }
  if (code === NO_METHOD) return new VaultError('This Hermes can’t keep passwords yet. Update it, then try again.')
  if (code !== VAULT_FAILED) return new VaultError('Can’t reach Hermes. Check that it’s running, then try again.')
  if (/authenticator key|otpauth|totp/i.test(message))
    return new VaultError('That setup key doesn’t look right. Paste the key the site shows, or its otpauth:// link.')
  if (/origin/i.test(message)) return new VaultError('Check the website’s address.')
  return new VaultError(failed)
}

async function add(agentId: string, input: VaultInput) {
  const wire = toWire(input)
  if (!wire) throw new VaultError('Fill in everything it needs first.')
  try {
    return (await rpc<{ id: string }>('vault.add', { profile: agentId, ...wire })).id
  } catch (error) {
    throw friendly(error)
  }
}

async function remove(agentId: string, id: string) {
  try {
    await rpc('vault.remove', { profile: agentId, id })
  } catch (error) {
    throw friendly(error, 'Hermes couldn’t delete that. Try again in a moment.')
  }
}

export function vaultActions(qc: QueryClient, agentId: string) {
  const key = vaultKey(agentId)
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const drop = (id: string) => qc.setQueryData<VaultEntry[]>(key, (list) => list?.filter((e) => e.id !== id))

  return {
    /** Saves a new item; its id once Hermes has it. */
    add: (input: VaultInput) => add(agentId, input).finally(refresh),

    /** Puts a new item in the old one's place, and returns the new one's id. */
    replace: async (old: VaultEntry, input: VaultInput) => {
      const id = await add(agentId, input)
      // Saved: the old one going is tidying up. Should it fail, both show and either can go.
      await remove(agentId, old.id)
        .then(() => drop(old.id))
        .catch(() => {})
      void refresh()
      return id
    },

    remove: async (entry: VaultEntry) => {
      const before = qc.getQueryData<VaultEntry[]>(key)
      drop(entry.id)
      try {
        await remove(agentId, entry.id)
      } catch (error) {
        if (before) qc.setQueryData(key, before)
        throw error
      } finally {
        void refresh()
      }
    },
  }
}

export function useVaultActions(agentId: string) {
  return vaultActions(useQueryClient(), agentId)
}

// ── Sites ───────────────────────────────────────────────────────────────────

const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^.]+\.local)$/i

/**
 * The origin Hermes fills on, from what someone types or pastes:
 * "github.com", "https://www.amazon.com/ap/signin?…", "umbrel.local:8080".
 * Without a scheme a public site is https and one on this network http.
 */
export function originOf(site: string): string | undefined {
  const value = site.trim()
  if (!value || /\s/.test(value)) return undefined
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  let url: URL
  try {
    url = new URL(scheme ? value : `https://${value}`)
  } catch {
    return undefined
  }
  // "mailto:me@example.com" would otherwise read as a sign-in to example.com.
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined
  const host = url.hostname
  const local = LOCAL.test(host)
  // A public site needs a dot and a real top-level part ("github.com", not "github").
  if (!local && !/\.[a-z]{2,}$|\.xn--[a-z0-9-]+$/i.test(host)) return undefined
  if (!scheme && local) url.protocol = 'http:'
  return url.origin
}

/** "https://www.amazon.com" → "www.amazon.com"; a port stays. */
export const hostOf = (origin: string) => origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')

/** What a login signs in with, the way Hermes tells them apart when it saves one itself. */
export function identifierType(identifier: string): 'email' | 'phone' | 'username' {
  const value = identifier.trim()
  if (value.includes('@')) return 'email'
  if (/^\+?\d[\d\s().-]{5,}$/.test(value)) return 'phone'
  return 'username'
}

// ── Cards ───────────────────────────────────────────────────────────────────

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'unionpay'

const BRANDS: [CardBrand, string, RegExp][] = [
  ['amex', 'Amex', /^3[47]/],
  ['visa', 'Visa', /^4/],
  ['mastercard', 'Mastercard', /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/],
  ['discover', 'Discover', /^(6011|65|64[4-9])/],
  ['diners', 'Diners Club', /^3(0[0-5]|[689])/],
  ['jcb', 'JCB', /^35/],
  ['unionpay', 'UnionPay', /^62/],
]

export const digitsOf = (value: string) => value.replace(/\D/g, '')

export function cardBrand(number: string): CardBrand | undefined {
  const digits = digitsOf(number)
  return BRANDS.find(([, , prefix]) => prefix.test(digits))?.[0]
}

export const brandName = (brand: CardBrand | undefined) => BRANDS.find(([b]) => b === brand)?.[1]

/** Amex reads 4-6-5; everything else in fours. */
export function formatCardNumber(value: string) {
  const digits = digitsOf(value).slice(0, 19)
  const groups = cardBrand(digits) === 'amex' ? [4, 6, 5] : [4, 4, 4, 4, 3]
  const parts: string[] = []
  let at = 0
  for (const size of groups) {
    if (at >= digits.length) break
    parts.push(digits.slice(at, at + size))
    at += size
  }
  return parts.join(' ')
}

/** The Luhn check every card number passes. */
export function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return digits.length > 0 && sum % 10 === 0
}

export const cardNumberOk = (digits: string) => digits.length >= 12 && digits.length <= 19 && luhn(digits)
export const cvcOk = (cvc: string, number: string) =>
  cardBrand(number) === 'amex' ? cvc.length === 4 : cvc.length === 3 || cvc.length === 4

/** How a card is named in the list: "Visa •••• 4242". */
export function cardLabel(number: string) {
  const digits = digitsOf(number)
  return `${brandName(cardBrand(digits)) ?? 'Card'} •••• ${digits.slice(-4)}`
}

/** A card's brand and last four, read back from the label Murmur gave it (a card saved elsewhere has neither). */
export function cardFromLabel(label: string): { brand?: CardBrand; last4?: string } {
  const last4 = label.match(/(\d{4})\s*$/)?.[1]
  const brand = BRANDS.find(([, name]) => label.toLowerCase().startsWith(name.toLowerCase()))?.[0]
  return { brand, last4 }
}

/**
 * Typing an expiry: "1" stays, "12" gains its slash, "4" means April
 * ("04 / "), and deleting back over the slash takes it away.
 */
export function formatExpiry(value: string, previous = '') {
  let digits = digitsOf(value).slice(0, 4)
  if (/^[2-9]$/.test(digits)) digits = `0${digits}`
  if (digits.length < 2) return digits
  const deleting = value.length < previous.length && previous.endsWith(' / ') && digits.length === 2
  if (deleting) return digits.slice(0, 1)
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`
}

/** "12 / 30", "12/2030", "1230" → month and a four-digit year; undefined if it isn't a real month or has passed. */
export function parseExpiry(value: string, now = new Date()): { month: string; year: string } | undefined {
  const m = value.trim().match(/^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/)
  if (!m) return undefined
  const month = Number(m[1])
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  if (month < 1 || month > 12) return undefined
  // Good through the end of its month.
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return undefined
  if (year > now.getFullYear() + 30) return undefined
  return { month: String(month).padStart(2, '0'), year: String(year) }
}
