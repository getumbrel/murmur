// When a chat outgrows what the model can read at once, Hermes summarizes its
// earlier messages and keeps going (compaction). The agent then remembers
// those in brief and the recent ones word for word; the person still has
// every message. These read the summary Hermes leaves in a chat's history,
// and say the step the way the rest of a reply's steps are said.

import type { ChatItem } from './types'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

/** The live line while it happens, and the line it leaves afterwards. */
export const SUMMARIZING = 'Summarizing earlier messages'
export const SUMMARIZED = 'Summarized earlier messages'

// How Hermes opens the summary it hands the model (and how an older one did),
// and the line it puts between a message and a summary folded into it.
const OPENS = ['[CONTEXT COMPACTION — REFERENCE ONLY]', '[CONTEXT SUMMARY]:']
const FOLDED = '[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]'

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
    .join('')
}

/**
 * Whether a saved message holds Hermes's summary of the chat so far: as a
 * message of its own, or folded into one of the chat's messages when one of
 * its own wouldn't fit the conversation's turns. (Hermes then shows that
 * message without it, as `display_content`.)
 */
export function holdsSummary(row: { content?: unknown }) {
  const text = textOf(row.content).trimStart()
  const at = text.indexOf(FOLDED)
  const from = at >= 0 ? text.slice(at + FOLDED.length).trimStart() : text
  return OPENS.some((o) => from.startsWith(o))
}

/** The step as a reply's other steps are drawn: one line, "Summarized earlier messages · 14s". */
export function asStep(item: Of<'compaction'>): Of<'tool'> {
  const startedAt = item.startedAt ?? 0
  return {
    kind: 'tool',
    id: item.id,
    name: 'compaction',
    label: item.status === 'running' ? SUMMARIZING : SUMMARIZED,
    status: item.status,
    startedAt,
    endedAt: item.endedAt ?? startedAt,
    speaker: item.speaker,
  }
}
