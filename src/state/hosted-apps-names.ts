// What Murmur calls the apps that connect through Nous Research
// (state/hosted-apps.ts), apart from Hermes: each app's name, mark, what it's
// for, and the agent's tools for it. Pure, so chat labels can use it anywhere.

import type { ConnectorCatalogRow } from '@/hermes/vendor/gateway-contract.generated'
import { MARKS } from '@/features/apps/marks'

export type HostedApp = {
  /** Nous's name for it, which every call uses ("slack", "granola_mcp"). */
  slug: string
  /** As its maker writes it. */
  name: string
  /** What the agent can do with it, in a line; empty when Nous gives only a placeholder. */
  description: string
  /** What the connected row says under the name ("Messages and channels"). */
  summary: string
  /** Its key in MARKS, for AppIcon. Never Nous's logo: Murmur doesn't fetch icons. */
  icon: string
  /** An everyday app, rather than one for developers. */
  everyday: boolean
}

export const normal = (name: string) =>
  name
    .toLowerCase()
    .replace(/_mcp$/, '')
    .replace(/[^a-z0-9]/g, '')
const marksByName = new Map(Object.keys(MARKS).map((key) => [normal(key), key]))

// Nous's names for brands whose mark Murmur keeps under another key.
const ICON: Record<string, string> = {
  coinbase_agents_mcp: 'coinbase',
  coinbase_wallet_mcp: 'coinbase',
  discordbot: 'discord',
}

/** Hermes's apps that cover one of Nous's under another name. */
export const TWIN: Record<string, string> = { confluence: 'atlassian', jira: 'atlassian' }

const EVERYDAY_CATEGORIES = new Set([
  'Commerce',
  'Communication',
  'Design and media',
  'Files and docs',
  'Sales and support',
  'Work management',
])
// Email for developers, though Nous files them under Communication.
const FOR_DEVELOPERS = new Set(['resend_mcp', 'sendgrid'])

// For apps Nous describes only as "Use … through Hermes".
const ABOUT: Record<string, string> = {
  ahrefs_mcp: 'Research keywords, backlinks and rankings',
  circleback_mcp: 'Search meeting notes and action items',
  greptile_mcp: 'Ask questions about your code',
  higgsfield_mcp: 'Make images and videos with AI',
  pylon_mcp: 'Read and answer customer issues',
  ramp_mcp: 'Review spending, cards and bills',
  statsig_mcp: 'Check feature gates and experiments',
}

// What a connected row says under the app's name.
const SUMMARY: Record<string, string> = {
  airtable: 'Bases and records',
  apollo: 'Contacts and outreach',
  asana: 'Tasks and projects',
  ashby: 'Candidates and jobs',
  box: 'Files and folders',
  calendly: 'Bookings and links',
  confluence: 'Wiki pages',
  discordbot: 'Your server, as a bot',
  gmail: 'Email',
  googlecalendar: 'Events',
  googledocs: 'Documents',
  googledrive: 'Files',
  googlesheets: 'Spreadsheets',
  granola_mcp: 'Meeting notes',
  jira: 'Issues',
  linear: 'Issues and projects',
  notion: 'Pages and databases',
  pandadoc_mcp: 'Documents',
  plain: 'Support threads',
  shopify: 'Products, orders and customers',
  slack: 'Messages and channels',
}

const PLACEHOLDER = /^use .+ through hermes\.?$/i
/** A slug Murmur will pass back to Hermes. */
export const SLUG = /^[a-z0-9][a-z0-9_-]*$/

/** The app as Murmur offers it, from Nous's catalog row (or just its slug, for an account Nous no longer lists). */
export function hostedAppFrom(row: Pick<ConnectorCatalogRow, 'slug'> & Partial<ConnectorCatalogRow>): HostedApp {
  const { slug } = row
  const twin = marksByName.get(normal(slug))
  const icon = ICON[slug] ?? twin ?? slug
  const said = (row.description ?? '').trim()
  const description = ABOUT[slug] ?? (PLACEHOLDER.test(said) ? '' : said)
  const name =
    (twin && MARKS[twin][0]) ||
    row.name?.trim() ||
    slug
      .replace(/_mcp$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    slug,
    name,
    description,
    summary: SUMMARY[slug] ?? description,
    icon,
    everyday: !FOR_DEVELOPERS.has(slug) && EVERYDAY_CATEGORIES.has(row.category ?? ''),
  }
}

/**
 * A tool of an app connected through Nous, as Hermes names it for the agent
 * (`connectors__slack__SEND_MESSAGE`, run through tool_call): its app, and
 * what it does in plain words ("send message"). Null for any other tool.
 */
export function connectorTool(name: string): { app: HostedApp; action: string } | null {
  // Split at the first two separators, as Hermes does (tools/connectors/gateway/names.py).
  const match = /^connectors__([a-z0-9][a-z0-9_-]*?)__(.+)$/.exec(name)
  if (!match) return null
  const [, slug, tool] = match
  // Hermes strips the app's own prefix (SLACK_); a tool named another way keeps it.
  const action = tool
    .replace(new RegExp(`^${slug.replace(/[^a-z0-9]/g, '_')}_`, 'i'), '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return { app: hostedAppFrom({ slug }), action }
}
