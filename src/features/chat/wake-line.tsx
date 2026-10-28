import type { ReactNode } from 'react'
import { Orb } from '@/ui/orb'
import type { ChatItem, WakeReason } from './types'
import { ToolIcon } from './tool-icon'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

const SAID: Record<Exclude<WakeReason, 'helpers'>, string> = {
  command: 'Command finished',
  resume: 'Picked up where it left off',
  update: 'Checked back in',
}

/**
 * What woke the agent, when it wasn't you: one quiet line opening its turn.
 * A command it left running shows as the command; the agent picking itself
 * back up shows as the agent. (Helpers coming back are their own faces, in
 * Helpers.)
 */
export function WakeLine({ item, hue, seed }: { item: Of<'wake'>; hue: number; seed?: string }) {
  if (item.reason === 'helpers') return null
  let mark: ReactNode = <Orb hue={hue} size={20} seed={seed} />
  if (item.reason === 'command')
    mark = (
      <span className="flex size-5 items-center justify-center rounded-full bg-fill-2 text-ink-2">
        <ToolIcon category="terminal" size={12} />
      </span>
    )
  return (
    <p className="-mx-1 flex h-8 max-w-full items-center gap-2 px-1 text-subhead text-ink-3">
      <span className="flex flex-none">{mark}</span>
      <span className="truncate">{SAID[item.reason]}</span>
    </p>
  )
}
