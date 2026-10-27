import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Share, SquarePlus, X } from 'lucide-react'
import { MurmurMark } from '@/ui/brand'
import { Button } from '@/ui/button'
import { cn } from '@/lib/cn'
import { useChats } from '@/state/chats'
import { useMedia } from '@/lib/use-media'
import { ios, standalone } from '@/lib/device'

// "Put Murmur on your Home Screen": once, on a phone, after the first chat
// that got a reply. iOS can't be asked, so it shows the two taps (Share, then
// Add to Home Screen). Android and other Chromium browsers offer their own
// install prompt; the tip's button opens it, and with no prompt there's no tip.
// Never once installed, never on a computer. Kept beside the other tips'
// flags (murmur:tip-dismissed:*), shared by every Hermes.

const SEEN = 'murmur:tip-dismissed:install'
const CHATTED = 'murmur:chatted'

const read = (key: string) => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const write = (key: string) => {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Private mode: it lasts the visit.
  }
}

// ── What we know, outside React (the browser's prompt can come before Home does) ─

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let prompt: InstallPrompt | undefined
let seen = read(SEEN)
let chatted = read(CHATTED)
/** Shown on this visit: it stays until you leave the app, then never again. */
let showing = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn))

if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', (e) => {
    // Ours offers it at a better moment than the browser's mini bar would.
    e.preventDefault()
    prompt = e as InstallPrompt
    notify()
  })
  addEventListener('appinstalled', () => {
    prompt = undefined
    dismiss()
  })
  // The first reply that comes back in full, anywhere.
  if (!chatted) {
    const stop = useChats.subscribe((s) => {
      if (!Object.values(s.chats).some((c) => (c.turns ?? 0) > 0 && c.status === 'idle')) return
      chatted = true
      write(CHATTED)
      stop()
      notify()
    })
  }
}

function dismiss() {
  seen = true
  showing = false
  write(SEEN)
  notify()
}

const snapshot = () => `${seen}:${chatted}:${showing}:${!!prompt}`

/** Whether Home shows the tip now (so it can hold back its other suggestion). */
export function useInstallTip() {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  const phone = useMedia('(pointer: coarse) and (max-width: 899px)')
  const kind = ios ? 'ios' : prompt ? 'prompt' : null
  const eligible = phone && !!kind && !standalone() && (showing || (!seen && chatted))
  // The first time it's shown counts as seen; it stays for the rest of this visit.
  useEffect(() => {
    if (!eligible || showing) return
    showing = true
    write(SEEN)
  }, [eligible])
  return eligible ? kind : null
}

const spring = { type: 'spring', duration: 0.5, bounce: 0.15 } as const

export function InstallTip({ kind }: { kind: 'ios' | 'prompt' | null }) {
  const [installing, setInstalling] = useState(false)
  const install = async () => {
    if (!prompt) return dismiss()
    setInstalling(true)
    try {
      await prompt.prompt()
      await prompt.userChoice
    } finally {
      // A prompt works once, whatever the answer.
      prompt = undefined
      setInstalling(false)
      dismiss()
    }
  }

  return (
    <AnimatePresence initial={false}>
      {kind && (
        <motion.div
          key="install"
          className="px-5 pb-5"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring, delay: 0.25 } }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
        >
          <section
            aria-labelledby="install-tip"
            className="relative rounded-2xl bg-fill-1 p-4 pr-12 ring-[0.5px] ring-line ring-inset"
          >
            <div className="flex items-start gap-3.5">
              {/* The icon, as it'll sit on the Home Screen. */}
              <span className="flex-none overflow-hidden rounded-[11px] ring-[0.5px] ring-line">
                <MurmurMark tile size={48} label="" />
              </span>
              <div className="min-w-0 pt-0.5">
                <h2 id="install-tip" className="text-body font-semibold tracking-[-0.015em]">
                  {kind === 'ios' ? 'Add to Home Screen' : 'Install Murmur'}
                </h2>
                <p className="mt-0.5 text-footnote text-balance text-ink-2">
                  Open Murmur like an app, full screen, in one tap.
                </p>
              </div>
            </div>
            {/* The steps may run under the ✕'s column; it sits up by the title. */}
            {kind === 'ios' ? (
              <HomeScreenSteps className="mt-3.5 -mr-8 pl-[62px]" />
            ) : (
              <div className="mt-3 pl-[62px]">
                <Button variant="accent" size="sm" loading={installing} onClick={() => void install()}>
                  Install
                </Button>
              </div>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismiss}
              className="pressable absolute top-2 right-2 grid size-8 place-items-center rounded-full text-ink-3 before:absolute before:-inset-1.5 before:content-[''] hover:bg-fill-2 hover:text-ink-2"
            >
              <X size={15} strokeWidth={2.25} />
            </button>
          </section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Safari's two taps to put Murmur on the Home Screen, drawn the way Safari draws them. */
export function HomeScreenSteps({ className }: { className?: string }) {
  return (
    <ol className={cn('space-y-2 text-footnote text-ink', className)}>
      <Step n={1}>
        Tap
        <Glyph>
          <Share size={14} strokeWidth={2} />
        </Glyph>
        <span className="font-medium">Share</span>
      </Step>
      <Step n={2}>
        Choose
        <Glyph>
          <SquarePlus size={14} strokeWidth={2} />
        </Glyph>
        <span className="font-medium">Add to Home Screen</span>
      </Step>
    </ol>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid size-5 flex-none place-items-center rounded-full bg-fill-2 text-[11px] font-semibold text-ink-2 tabular-nums"
      >
        {n}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">{children}</span>
    </li>
  )
}

/** The button as Safari draws it, so it's easy to spot. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="inline-grid size-6 place-items-center rounded-md bg-elevated text-accent shadow-[0_0.5px_1px_rgb(0_0_0/0.08)] ring-[0.5px] ring-line"
    >
      {children}
    </span>
  )
}
