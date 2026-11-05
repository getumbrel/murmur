import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ClipboardPaste, Keyboard, X } from 'lucide-react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Orb } from '@/ui/orb'
import { Button, IconButton } from '@/ui/button'
import { cn } from '@/lib/cn'
import { useIsWide } from '@/lib/use-media'
import type { Speaker } from '@/features/chat/types'
import { takeOver, useControl, useStill } from '@/state/screen'
import { giveBack, LiveView, type LiveViewHandle } from './live-view'

/** What the viewer shows: whose browser, the site it's on, and what the agent asked for, if it did. */
export type Viewing = { profile: string; agent: Speaker; site?: string; reason?: string }

const useViewer = create<{ viewing?: Viewing; open: boolean }>(() => ({ open: false }))

/** Opens the agent's browser big, over everything. */
export const openViewer = (viewing: Viewing) => useViewer.setState({ viewing, open: true })

/** Takes over the agent's browser and opens it big, for the person to do what it asked. */
export async function takeOverAndOpen(viewing: Viewing) {
  try {
    await takeOver(viewing.profile, viewing.reason)
    openViewer(viewing)
  } catch {
    toast.error('Couldn’t take over the browser. Try again.')
  }
}

/**
 * The agent's browser, live and big (one, over everything). Watching: what it's
 * doing right now, with Take over. In control: your pointer and keys reach the
 * page, the frame wears the agent's colour, and Hand back gives it back, as
 * does closing. Phones get the whole screen, the one action under the thumb,
 * a keyboard and a Paste key; wide, it's a window over the chat, and ⌘V or
 * Ctrl+V pastes.
 */
export function ScreenViewer() {
  const { viewing, open } = useViewer()
  if (!viewing) return null
  return <Viewer viewing={viewing} open={open} />
}

function Viewer({ viewing, open }: { viewing: Viewing; open: boolean }) {
  const { profile, agent, site } = viewing
  const wide = useIsWide()
  const reduce = useReducedMotion()
  const control = useControl(profile)
  const yours = control === 'you'
  const live = useRef<LiveViewHandle>(null)
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pasting, setPasting] = useState(false)
  const pasteField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!yours) setPasting(false)
  }, [yours])
  // Until the live picture arrives, the latest still stands in.
  const still = useStill(profile, open && !yours, 2000)

  const close = () => useViewer.setState({ open: false })
  const act = async () => {
    setBusy(true)
    try {
      if (yours) {
        await giveBack(profile)
        close()
      } else await takeOver(profile, viewing.reason)
    } catch {
      toast.error(yours ? 'Couldn’t hand the browser back. Try again.' : 'Couldn’t take over the browser. Try again.')
    } finally {
      setBusy(false)
    }
  }
  // The phone's Paste key: what you copied goes straight into the page where the browser lets
  // Murmur read it (iOS asks with its own Paste button), and otherwise you paste it into a field.
  const openField = () => {
    flushSync(() => setPasting(true))
    pasteField.current?.focus({ preventScroll: true })
  }
  const paste = () => {
    if (!navigator.clipboard?.readText) return openField()
    navigator.clipboard
      .readText()
      .then((text) => (text ? live.current?.paste(text) : toast('Nothing’s copied to paste.')), openField)
  }
  const pasted = (text: string) => {
    live.current?.paste(text)
    setPasting(false)
  }
  // A paste, or a keyboard's clipboard putting it all in at once; typed, it goes with Return.
  const onFieldInput = (e: FormEvent<HTMLInputElement>) => {
    const { inputType, data } = e.nativeEvent as InputEvent
    const value = e.currentTarget.value
    if (
      value &&
      (!inputType ||
        inputType === 'insertFromPaste' ||
        inputType === 'insertReplacementText' ||
        (inputType === 'insertText' && (data?.length ?? 0) > 1))
    )
      pasted(value)
  }

  // Closing while in control hands back: nobody's left to finish.
  const onOpenChange = (next: boolean) => {
    if (next) return
    if (yours) void act()
    else close()
  }

  const title = yours
    ? 'You’re in control'
    : control === 'elsewhere'
      ? 'In control on another device'
      : `${agent.name}’s browser`
  const sub = control === 'agent' ? site : site ? `${agent.name} is waiting · ${site}` : `${agent.name} is waiting`
  const action = (
    <Button
      variant={yours ? 'accent' : 'primary'}
      size={wide ? 'md' : 'lg'}
      loading={busy}
      onClick={act}
      className={cn(wide && 'min-w-28')}
    >
      {yours ? `Hand back to ${agent.name}` : control === 'elsewhere' ? 'Take over here' : 'Take over'}
    </Button>
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Over everything, a call included: it's where you help the agent. */}
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-[70] bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.24 }}
          />
        </Dialog.Overlay>
        <Dialog.Content
          aria-describedby={undefined}
          data-screen-viewer
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'hue-scope fixed z-[70] flex flex-col bg-bg outline-none',
            wide
              ? 'top-1/2 left-1/2 h-[min(820px,90dvh)] w-[min(1240px,94vw)] -translate-1/2 rounded-2xl shadow-sheet'
              : 'inset-0',
          )}
          style={{ '--hue': agent.hue } as CSSProperties}
        >
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: wide ? 0.97 : 1, y: wide ? 8 : 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', duration: 0.45, bounce: 0.1 }}
          >
            <header className={cn('safe-top flex flex-none items-center gap-3', wide ? 'h-[72px] px-6' : 'h-16 px-4')}>
              <Orb
                hue={agent.hue}
                size={wide ? 34 : 30}
                state={control === 'agent' ? 'working' : 'waiting'}
                seed={agent.id}
              />
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate text-subhead font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
                <p className="flex min-w-0 items-center gap-1.5 text-caption text-ink-3">
                  {control === 'agent' && (
                    <span className="live-dot relative flex size-1.5 flex-none">
                      <span className="size-1.5 rounded-full bg-accent" />
                    </span>
                  )}
                  <span className="truncate">{control === 'agent' ? (sub ? `Live · ${sub}` : 'Live') : sub}</span>
                </p>
              </div>
              {wide && action}
              {(wide || !yours) && (
                <Dialog.Close asChild>
                  <IconButton label={yours ? 'Hand back and close' : 'Close'} variant="filled" size="md">
                    <X size={18} strokeWidth={2} />
                  </IconButton>
                </Dialog.Close>
              )}
            </header>
            <LiveView
              ref={live}
              profile={profile}
              fit={!wide}
              still={still}
              onTyping={setTyping}
              off={
                <p className="absolute inset-0 grid place-items-center px-8 text-center text-subhead text-ink-3">
                  {agent.name}’s browser is closed. It opens here when {agent.name} browses.
                </p>
              }
              className={cn('min-h-0 flex-1', wide ? 'px-6 pb-6' : 'px-3 pb-3')}
            />
            {!wide && (
              <footer className="flex-none px-4 pt-1 pb-[max(16px,env(safe-area-inset-bottom))]">
                <AnimatePresence mode="popLayout" initial={false}>
                  {pasting ? (
                    <motion.div
                      key="paste"
                      className="flex items-center gap-3"
                      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <label className="relative flex min-w-0 flex-1 items-center">
                        <ClipboardPaste
                          size={18}
                          strokeWidth={1.75}
                          aria-hidden
                          className="pointer-events-none absolute left-4.5 text-ink-3"
                        />
                        <input
                          ref={pasteField}
                          aria-label="Paste into the page"
                          placeholder="Paste here"
                          enterKeyHint="send"
                          autoComplete="off"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          data-1p-ignore
                          data-lpignore="true"
                          className="h-13 w-full rounded-full bg-fill-2 pr-5 pl-12 text-body text-ink ring-1 ring-transparent outline-none ring-inset placeholder:text-ink-3 focus:ring-line-strong"
                          onPaste={(e) => {
                            e.preventDefault()
                            const text = e.clipboardData.getData('text/plain')
                            if (text) pasted(text)
                          }}
                          onInput={onFieldInput}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' || !e.currentTarget.value) return
                            e.preventDefault()
                            pasted(e.currentTarget.value)
                          }}
                          onBlur={() => setPasting(false)}
                        />
                      </label>
                      <IconButton
                        label="Cancel"
                        variant="filled"
                        size="lg"
                        className="size-13"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => setPasting(false)}
                      >
                        <X size={20} strokeWidth={1.75} />
                      </IconButton>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="keys"
                      className="flex items-center gap-3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {yours && (
                        <>
                          <IconButton
                            label={typing ? 'Hide keyboard' : 'Keyboard'}
                            aria-pressed={typing}
                            variant="filled"
                            size="lg"
                            className="size-13"
                            // Before the tap's focus moves: the keyboard only opens from within the tap itself.
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => live.current?.keyboard()}
                          >
                            <Keyboard size={20} strokeWidth={1.75} />
                          </IconButton>
                          <IconButton
                            label="Paste"
                            variant="filled"
                            size="lg"
                            className="size-13"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={paste}
                          >
                            <ClipboardPaste size={20} strokeWidth={1.75} />
                          </IconButton>
                        </>
                      )}
                      <div className="min-w-0 flex-1">{action}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </footer>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
