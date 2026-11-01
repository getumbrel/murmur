import { describe, expect, it } from 'vitest'
import { asStep, holdsSummary, SUMMARIZED, SUMMARIZING } from './compaction'
import { summary } from './work'

// How Hermes 0.22.5 writes the summary it hands the model (agent/context_compressor.py).
const HANDOFF = '[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below.'
const END = '--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---'
const FOLDED = '[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]'

describe('a chat Hermes has summarized', () => {
  it('knows the summary as a message of its own', () => {
    expect(holdsSummary({ content: `${HANDOFF}\n\n## Goal\nPlan the trip\n\n${END}` })).toBe(true)
    expect(holdsSummary({ content: '[CONTEXT SUMMARY]: what an older Hermes wrote' })).toBe(true)
    expect(holdsSummary({ content: [{ type: 'text', text: `  ${HANDOFF}` }] })).toBe(true)
  })

  it('knows a summary folded into one of the chat’s messages', () => {
    const folded = `[PRIOR CONTEXT — for reference only; not a new message]\nBooked it.\n\n${FOLDED}\n\n${HANDOFF}\n\n${END}`
    expect(holdsSummary({ content: folded })).toBe(true)
    // Folded ahead of the message it came with, for a model that wants the summary first.
    expect(holdsSummary({ content: `${HANDOFF}\n\n${END}\n\nAnd now the itinerary?` })).toBe(true)
  })

  it('leaves the person’s own words alone, even ones that quote it', () => {
    expect(holdsSummary({ content: 'What does [CONTEXT COMPACTION mean?' })).toBe(false)
    expect(holdsSummary({ content: `${FOLDED} is what I saw` })).toBe(false)
    expect(holdsSummary({ content: null })).toBe(false)
    expect(holdsSummary({})).toBe(false)
  })
})

describe('the step', () => {
  it('says what it’s doing while it happens', () => {
    const step = asStep({ kind: 'compaction', id: 'k', status: 'running', startedAt: 1_000 })
    expect(step).toMatchObject({ kind: 'tool', label: SUMMARIZING, status: 'running' })
  })

  it('says what it did, and for how long, once it’s done', () => {
    const step = asStep({ kind: 'compaction', id: 'k', status: 'done', startedAt: 1_000, endedAt: 15_000 })
    expect(summary([step])).toBe(`${SUMMARIZED} · 14s`)
  })

  it('has no time when it was read back from the chat', () => {
    expect(summary([asStep({ kind: 'compaction', id: 'k', status: 'done' })])).toBe(SUMMARIZED)
  })
})
