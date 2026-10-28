import { describe, expect, it } from 'vitest'
import { hostedAppFrom } from '@/state/hosted-apps-names'
import { MARKS } from './marks'

// Every app Murmur offers draws as itself, never as a letter: its real icon
// (icons/) or its glyph on its colour (marks.ts).
const ICONS = new Set(
  Object.keys(import.meta.glob('./icons/*.svg')).map((p) => p.slice('./icons/'.length, -'.svg'.length)),
)
const drawn = (key: string) => ICONS.has(key) || Boolean(MARKS[key]?.[2])

// Nous's public catalog on 2026-10-28 (portal.nousresearch.com/api/v1/connectors/catalog/public).
const NOUS = [
  'adobe_marketing_agent_mcp',
  'ahrefs_mcp',
  'airtable',
  'amplitude_mcp',
  'apollo',
  'asana',
  'ashby',
  'better_stack_mcp',
  'box',
  'calendly',
  'canva_mcp',
  'cashfree_payments_mcp',
  'circleback_mcp',
  'clickhouse_mcp',
  'clickup_mcp',
  'cloudflare_mcp',
  'coinbase_agents_mcp',
  'coinbase_wallet_mcp',
  'confluence',
  'customerio_mcp',
  'datadog_mcp',
  'discordbot',
  'granola_mcp',
  'greptile_mcp',
  'higgsfield_mcp',
  'intercom_mcp',
  'jira',
  'linear',
  'memelord_mcp',
  'metabase',
  'mintlify_mcp',
  'neon_mcp',
  'notion',
  'pandadoc_mcp',
  'peopledatalabs',
  'plaid_mcp',
  'plain',
  'posthog_mcp',
  'pylon_mcp',
  'railway',
  'ramp_mcp',
  'resend_mcp',
  'semrush',
  'sendgrid',
  'sentry_mcp',
  'shopify',
  'slack',
  'statsig_mcp',
  'stripe_mcp',
  'supabase',
  'todoist_mcp',
  'turso',
  'vercel_mcp',
  'wispr_flow_mcp',
]

describe('app icons', () => {
  it('draws every app Murmur names', () => {
    expect(Object.keys(MARKS).filter((key) => !drawn(key))).toEqual([])
  })

  it('draws every app Nous offers', () => {
    expect(NOUS.map((slug) => hostedAppFrom({ slug }).icon).filter((key) => !drawn(key))).toEqual([])
  })

  it('keeps an icon only for an app Murmur names', () => {
    expect([...ICONS].filter((key) => !MARKS[key])).toEqual([])
  })
})
