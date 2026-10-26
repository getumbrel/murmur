import { useState, type CSSProperties } from 'react'
import { motion, useAnimationControls } from 'motion/react'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/field'
import { Orb } from '@/ui/orb'
import { Sheet } from '@/ui/sheet'
import { titleTaken } from '@/state/chats'
import type { Agent } from '@/state/agents'

// Give a chat a name of your own, from its row's menu or its own. The agent
// never names it over again, and Hermes Desktop shows the same name. Each of
// an agent's chats has its own: a name that's taken says so in place.

/** Hermes's longest title. */
const MAX = 100

type Props = {
  agent: Pick<Agent, 'id' | 'name' | 'hue'>
  /** The chat being renamed; null when the sheet is closed. */
  chat: { id: string; title: string } | null
  onClose: () => void
  onRename: (title: string) => Promise<void>
}

export function RenameChatSheet({ agent, chat, onClose, onRename }: Props) {
  // Kept while the sheet closes, so it doesn't empty as it goes.
  const [shown, setShown] = useState(chat)
  const [name, setName] = useState(chat?.title ?? '')
  const [taken, setTaken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const shake = useAnimationControls()
  if (chat && chat !== shown) {
    setShown(chat)
    setName(chat.title)
    setTaken(false)
    setFailed(false)
  }

  const save = async () => {
    const title = name.trim().replace(/\s+/g, ' ')
    if (!shown || !title) return
    if (title === shown.title) return onClose()
    setBusy(true)
    setFailed(false)
    try {
      await onRename(title)
      onClose()
    } catch (e) {
      if (titleTaken(e)) setTaken(true)
      else setFailed(true)
      void shake.start({ x: [0, -7, 6, -4, 2, 0], transition: { duration: 0.36, ease: 'easeOut' } })
    } finally {
      setBusy(false)
    }
  }

  const note = taken ? 'Another chat already has that name.' : failed ? 'Couldn’t rename it. Try again.' : null

  return (
    <Sheet open={!!chat} onOpenChange={(open) => !open && onClose()} title="Rename chat" width={380}>
      <form
        className="hue-scope flex flex-col items-center pt-1"
        style={{ '--hue': agent.hue } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Orb hue={agent.hue} size={64} seed={agent.id} />
        <motion.div animate={shake} className="mt-6 w-full">
          <TextField
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setTaken(false)
              setFailed(false)
            }}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={MAX}
            autoComplete="off"
            enterKeyHint="done"
            aria-label="Chat name"
            aria-invalid={!!note || undefined}
            aria-describedby={note ? 'rename-chat-note' : undefined}
            autoFocus
            className={note ? 'text-center ring-danger/50! focus:ring-danger/70!' : 'text-center'}
          />
        </motion.div>
        <p
          id="rename-chat-note"
          role={note ? 'alert' : undefined}
          className="mt-2 min-h-5 w-full text-center text-footnote text-pretty text-danger"
        >
          {note}
        </p>
        <div className="mt-3 w-full">
          <Button type="submit" variant="accent" size="lg" loading={busy} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
