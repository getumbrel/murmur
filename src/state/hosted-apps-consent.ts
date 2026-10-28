// Asking once before apps go through Nous Research (state/hosted-apps.ts).
//
// The first app connected through Nous creates a Nous identity for this
// Hermes: an account at Nous, made without a sign-in. Murmur asks the person
// first, once per Hermes, and keeps the answer where every browser and device
// sees it: the main agent's ui_meta, under 'murmur-nous' (the way WhatsApp's
// linked account is kept, state/whatsapp.ts).
//
// The identity is per Hermes, not per agent. Hermes keeps it in the main
// agent's auth.json, and agents Murmur makes share the main agent's sign-ins
// (profiles.create's share_auth), so asking again for each agent would ask
// the same question twice.

import { rpc } from '@/hermes/gateway'
import { isMissingMethod, listProfiles } from '@/hermes/compat'

/** The main agent: where the identity and the answer live. */
export const MAIN_AGENT = 'default'
export const CONSENT_KEY = 'murmur-nous'

/** Nous's own page on how it handles data (the one Hermes Desktop links to). */
export const NOUS_PRIVACY_URL = 'https://portal.nousresearch.com/privacy'

type Profile = { name: string; is_default?: boolean; ui_meta?: Record<string, unknown> | null }

/** When the person agreed, from the agents Hermes lists (the main agent's ui_meta), or null. */
export function consentOf(profiles: readonly Profile[]): Date | null {
  const main = profiles.find((p) => p.is_default) ?? profiles.find((p) => p.name === MAIN_AGENT)
  const meta = main?.ui_meta?.[CONSENT_KEY] as { since?: unknown } | null | undefined
  return typeof meta?.since === 'number' ? new Date(meta.since) : null
}

// Asked once per page load: it only changes by agreeing, which this tab does
// itself (another tab's answer is read on its next load).
let consent: Promise<boolean> | null = null
let allowed: Promise<boolean> | null = null

/** Whether the person agreed to apps through Nous on this Hermes. Throws when Hermes can't say. */
export function hostedConsent(): Promise<boolean> {
  consent ??= listProfiles<Profile & { is_default: boolean }>()
    .then((profiles) => consentOf(profiles) !== null)
    .catch((error) => {
      consent = null
      throw error
    })
  return consent
}

/** Whether this Hermes already has a Nous identity made for apps (free_tier.status reads it from disk). */
async function hasNousGuest() {
  try {
    const status = await rpc<{ has_guest?: unknown }>('free_tier.status', { profile: MAIN_AGENT })
    return status.has_guest === true
  } catch (error) {
    if (isMissingMethod(error)) return false
    throw error
  }
}

/**
 * Whether agents may reach apps through Nous themselves (Hermes's
 * `connections` toolset, state/toolsets.ts): once the person agreed, or when
 * this Hermes already has a Nous identity from before Murmur asked (an agent
 * set one up in a chat). Then nothing new can be created, and switching it off
 * would only take away apps the person already connected.
 */
export function hostedAppsAllowed(): Promise<boolean> {
  allowed ??= hostedConsent()
    .then(async (agreed) => agreed || (await hasNousGuest()))
    .catch((error) => {
      allowed = null
      throw error
    })
  return allowed
}

/** Records that the person agreed. Throws when Hermes didn't keep it, so nothing connects without it. */
export async function recordHostedConsent() {
  const res = await rpc<{ applied?: { ui_meta?: unknown } }>('profiles.configure', {
    name: MAIN_AGENT,
    ui_meta: { [CONSENT_KEY]: { since: Date.now() } },
  })
  if (res.applied?.ui_meta !== true) throw new Error('Hermes didn’t keep the answer')
  consent = Promise.resolve(true)
  allowed = Promise.resolve(true)
}

/** Forgets what this page load read, so the next question asks Hermes again. */
export function forgetHostedConsent() {
  consent = null
  allowed = null
}
