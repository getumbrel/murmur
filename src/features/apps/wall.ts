// What the Apps sheet's wall offers, in order: Email first (until the agent
// has an account, on any Hermes), then everyday apps, Hermes's own
// and those through Nous among them by how much they're used, then developer
// tools. Nothing already connected, and nothing that can't connect. Search
// covers all of it, by name, what it does, and the names people know it by.

import { arrangeApps, type AppTile, type HostedApp } from '@/state/hosted-apps'
import type { CatalogApp } from '@/state/apps'
import { originOf } from '@/state/vault'

export type WallItem = { kind: 'email'; key: 'email' } | AppTile

export const EMAIL_TILE: WallItem = { kind: 'email', key: 'email' }

/** Words an app is also known by, so searching for one finds it. */
const ALSO: Record<string, string[]> = {
  email: ['mail', 'inbox', 'gmail', 'google mail', 'icloud', 'fastmail', 'yahoo', 'outlook', 'imap'],
  atlassian: ['jira', 'confluence'],
  'wordpress-com': ['blog'],
}

export type Wall = { everyday: WallItem[]; developer: WallItem[] }

export function arrangeWall({
  direct,
  hosted,
  nameOf,
  email,
  added,
  connectedSlugs,
}: {
  /** Hermes's catalog. */
  direct: CatalogApp[]
  /** Nous's apps (none when this Hermes can't reach them). */
  hosted: readonly HostedApp[]
  nameOf: (name: string) => string
  /** Offer email: the agent hasn't connected an account (a Hermes without the plugin gets it added first). */
  email: boolean
  /** Hermes's apps the agent already has. */
  added: ReadonlySet<string>
  /** Nous's apps with an account on this Hermes. */
  connectedSlugs: ReadonlySet<string>
}): Wall {
  const { everyday, developer } = arrangeApps(direct, hosted, nameOf)
  const fresh = (tile: AppTile) => (tile.kind === 'direct' ? !added.has(tile.app.name) : !connectedSlugs.has(tile.app.slug))
  return {
    everyday: [...(email ? [EMAIL_TILE] : []), ...everyday.filter(fresh)],
    developer: developer.filter(fresh),
  }
}

/** The name a tile shows. */
export function itemName(item: WallItem, nameOf: (name: string) => string) {
  if (item.kind === 'email') return 'Email'
  return item.kind === 'direct' ? nameOf(item.app.name) : item.app.name
}

/** What a tile's app does, in a line. */
export function itemHint(item: WallItem) {
  if (item.kind === 'email') return 'Search, read and draft your email'
  return item.app.description
}

const keyOf = (item: WallItem) => (item.kind === 'email' ? 'email' : item.kind === 'direct' ? item.app.name : item.app.slug)

/** Whether a tile answers a search ("jira" finds Atlassian, "gmail" finds Email). */
export function matchesSearch(item: WallItem, query: string, nameOf: (name: string) => string) {
  const words = query.trim().toLowerCase()
  if (!words) return true
  const known = [itemName(item, nameOf), itemHint(item), ...(ALSO[keyOf(item)] ?? [])]
  return known.some((text) => text.toLowerCase().includes(words))
}

/** Every tile that answers a search, everyday apps first. */
export function searchWall(wall: Wall, query: string, nameOf: (name: string) => string) {
  return [...wall.everyday, ...wall.developer].filter((item) => matchesSearch(item, query, nameOf))
}

/**
 * A search for an address ("netflix.com") becomes the website of the login
 * it ends in (other.tsx). A name never does: Hermes fills a login in only on
 * the site it names, so a guessed one would be filled in on someone else's.
 */
export const siteFrom = (query = '') => (originOf(query) ? query.trim() : undefined)
