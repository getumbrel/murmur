import type { ChatItem } from '@/features/chat/types'
import { proseOf } from '@/features/media/parse'

// A chat as plain markdown, for pasting into Notes or a message: who said
// what, with the agent's steps folded to one line each.

export function transcript(items: ChatItem[], { title, agent }: { title?: string; agent: string }) {
  const out: string[] = []
  // Dated by when it began.
  const began = items.find((i) => i.kind === 'user')
  const date = new Date(began?.kind === 'user' ? began.at : Date.now()).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  out.push(`# ${title?.trim() || `Chat with ${agent}`}`, `${agent} · ${date}`)

  let speaker = ''
  let steps = false
  /** A paragraph under a name (the name only when the speaker changes). */
  const block = (name: string, text: string) => {
    out.push(name === speaker ? text : `**${name}**\n${text}`)
    speaker = name
    steps = false
  }
  /** One line per step, kept together as a list. */
  const step = (name: string, line: string) => {
    if (steps && name === speaker) out[out.length - 1] += `\n- ${line}`
    else block(name, `- ${line}`)
    steps = true
  }

  for (const item of items) {
    const name = 'speaker' in item && item.speaker ? item.speaker.name : agent
    switch (item.kind) {
      case 'user': {
        const files = item.attachments?.length
          ? item.attachments.map((a) => `[${a.kind === 'image' ? 'Photo' : 'File'}: ${a.name}]`)
          : (item.images ?? []).map(() => '[Photo]')
        block('You', [item.text.trim(), ...files].filter(Boolean).join('\n'))
        break
      }
      case 'assistant': {
        const text = proseOf(item.text)
        if (text) block(name, text)
        break
      }
      case 'tool':
        step(name, `${item.label}${item.detail ? `: ${item.detail}` : ''}${item.status === 'error' ? ' (didn’t work)' : ''}`)
        break
      case 'approval':
        step(
          name,
          `${item.command ? `Asked to run \`${item.command.split('\n')[0]}\`` : `Asked: ${item.title}`}${
            item.status === 'approved' ? ' (allowed)' : item.status === 'denied' ? ' (not allowed)' : ''
          }`,
        )
        break
      case 'clarify':
        for (const q of item.questions) {
          step(name, `Asked: ${q.question}`)
          const answer = item.answers?.[q.qid]
          if (answer) block('You', answer)
        }
        break
      case 'aside':
        block('You', `(Side question) ${item.question}`)
        if (item.answer) block(agent, item.answer)
        break
      case 'error':
        block(name, `_Couldn’t finish: ${item.message}_`)
        break
      case 'notice':
        out.push(`_${item.text}_`)
        speaker = ''
        steps = false
        break
      // Thinking and command output stay out: they're working notes.
    }
  }
  return out.join('\n\n').trim() + '\n'
}
