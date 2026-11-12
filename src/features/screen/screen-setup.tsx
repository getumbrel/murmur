import { Fragment, useState, type FormEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { create } from 'zustand'
import { Button } from '@/ui/button'
import { SecretField } from '@/ui/field'
import { BrowserIcon } from '@/ui/icons'
import { Sheet } from '@/ui/sheet'
import { rememberedSet } from '@/lib/upkeep'
import { firstHermes, hermesOf, mainFor, scoped } from '@/hermes/instance'
import { useCopy } from '@/features/chat/use-copy'
import { Swap } from '@/features/chat/collapse'
import type { Speaker } from '@/features/chat/types'
import { useServer } from '@/state/connection'
import { installScreen, useHostScreen, useInstall, useScreens, type Install } from '@/state/screen'

// Setting up the screen agents' browsers open on, on a Linux Hermes that
// doesn't have it: offered in the chat the first time an agent browses there,
// with Hermes's own installer, once (about 200 MB, and the server's password
// if it needs one). Everywhere the screen is, agents' browsers just show.

/** "Not now", for a week: nowhere else offers it, so it's offered again after that. */
const declined = rememberedSet(scoped('murmur:screen-setup:not-now'), 7 * 24 * 60 * 60_000)
/** Each Hermes host is offered its own: 'host' for the first, as it always was. */
const hostOf = (profile: string) => {
  const hermes = hermesOf(profile)
  return hermes && hermes !== firstHermes() ? `host@${hermes}` : 'host'
}

/** Whether to offer the screen where an agent's browser would show: a Linux Hermes without it, not declined lately. */
export function useScreenOffer(profile: string) {
  const host = useHostScreen(hermesOf(profile))
  const [later, setLater] = useState(() => declined.has(hostOf(profile)))
  return {
    offer: !!host?.supported && !host.installed && !later,
    notNow: () => {
      declined.add(hostOf(profile))
      setLater(true)
    },
  }
}

/** The setup that's asking for something, and the main agent of the Hermes it's on (there's one at a time). */
function useAsking<P extends Install['phase']>(phase: P) {
  return useInstall((s) => Object.keys(s).find((main) => s[main].phase === phase))
}

/** Hermes's "how to do it yourself", open after it couldn't. */
const useHow = create<{ open: boolean }>(() => ({ open: false }))

/**
 * The offer, where the agent's browser would be: what it gets you and what it
 * takes, then the setup itself, through to done.
 */
export function ScreenSetup({
  agent,
  onStart,
  onNotNow,
}: {
  agent: Speaker
  /** The setup's begun: the card stays to the end, whatever the chat does. */
  onStart: () => void
  onNotNow: () => void
}) {
  // The screen is its Hermes host's, set up through that Hermes's main agent.
  const main = mainFor(agent.id)
  const install = useInstall((s) => s[main]) ?? { phase: 'idle' }
  const [done, setDone] = useState(false)
  const setUp = async () => {
    onStart()
    await installScreen(main)
    if (useScreens.getState().screens[main]?.installed) setDone(true)
    else useHow.setState({ open: true })
  }
  const busy = install.phase === 'running' || install.phase === 'password'
  const state = done ? 'done' : busy ? 'busy' : install.phase === 'failed' ? 'failed' : 'offer'
  return (
    <div className="rounded-[14px] bg-elevated p-4 shadow-[inset_0_0_0_0.5px_var(--line-strong)]">
      <Swap id={state}>
        <div className="flex items-start gap-3">
          {done ? (
            <span
              aria-hidden
              className="grid size-9 flex-none place-items-center rounded-full bg-success/12 text-success"
            >
              <Check size={19} strokeWidth={2.25} />
            </span>
          ) : (
            <span aria-hidden className="mi-chip size-9 rounded-[9px]">
              <BrowserIcon size={22} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-subhead font-semibold tracking-[-0.01em]">
              {done ? 'All set' : state === 'failed' ? 'Couldn’t set it up' : `Watch ${agent.name} browse`}
            </h3>
            <p className="mt-0.5 text-footnote text-ink-2">
              {done ? (
                `You’ll see ${agent.name}’s browser here the next time it opens one.`
              ) : install.phase === 'password' ? (
                <span className="text-shimmer">Waiting for your server’s password</span>
              ) : busy ? (
                <span className="text-shimmer">Setting up on your server…</span>
              ) : state === 'failed' ? (
                'Your server needs a step from you first.'
              ) : (
                'See its browser here while it works, and take over when it needs you. Sets up once on your server, about 200 MB.'
              )}
            </p>
            {install.phase === 'running' && install.line && (
              <p className="mt-1 truncate font-mono text-caption text-ink-3">{install.line}</p>
            )}
          </div>
        </div>
        {!done && !busy && (
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onNotNow} className="text-ink-2">
              Not now
            </Button>
            {state === 'failed' ? (
              <Button variant="secondary" size="sm" onClick={() => useHow.setState({ open: true })}>
                See how
              </Button>
            ) : (
              <Button size="sm" onClick={() => void setUp()}>
                Set up
              </Button>
            )}
          </div>
        )}
      </Swap>
    </div>
  )
}

/** Where the setup asks for things, there whatever the chat does meanwhile. */
export function ScreenSheets() {
  return (
    <>
      <PasswordSheet />
      <HowSheet />
    </>
  )
}

/** Hermes asking for the server's password to install the screen: it goes to Hermes, and nowhere else. */
function PasswordSheet() {
  const main = useAsking('password')
  const install = useInstall((s) => (main ? s[main] : undefined))
  const [password, setPassword] = useState('')
  const asking = install?.phase === 'password' ? install : undefined
  const answer = (value: string) => {
    asking?.answer(value)
    setPassword('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password) answer(password)
  }
  return (
    <Sheet
      open={!!asking}
      onOpenChange={(open) => !open && answer('')}
      title="Your server’s password"
      description="Hermes needs it once to install the screen your agents’ browsers open on (about 200 MB). It goes straight to your server and isn’t kept."
    >
      <form onSubmit={submit} className="space-y-4 pt-3">
        <SecretField
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Your server’s password"
        />
        <Button type="submit" size="lg" disabled={!password}>
          Install
        </Button>
      </form>
    </Sheet>
  )
}

/**
 * When Hermes couldn't install it itself: what to run on the server instead,
 * after which agents' browsers show. A Hermes in a container has no way to install
 * anything, so there it's the image that has the screen: Nous's desktop one.
 */
function HowSheet() {
  const open = useHow((s) => s.open)
  const main = useAsking('failed')
  const install = useInstall((s) => (main ? s[main] : undefined))
  const failed = install?.phase === 'failed' ? install : undefined
  const hermes = useServer(main ? hermesOf(main) : firstHermes())
  const image = failed?.unprivileged && hermes?.fromImage
  const command = image
    ? hermes.hermesVersion && `nousresearch/hermes-agent:v${hermes.hermesVersion}-desktop`
    : failed?.command
  return (
    <Sheet
      open={open && !!failed}
      onOpenChange={(open) => useHow.setState({ open })}
      title={image ? 'Use Hermes’s desktop image' : 'Set it up on your server'}
      description={
        image
          ? 'Your Hermes runs in a container that can’t add the screen itself. Start it from Nous’s desktop image, which comes with it. Your agents’ browsers show from then on.'
          : failed?.unprivileged && command
            ? 'Hermes can’t install the screen your agents’ browsers open on: it has no sudo there. Run this as root on your server, and your agents’ browsers show from then on.'
            : command
              ? 'Hermes couldn’t install the screen your agents’ browsers open on. Run this on your server, and your agents’ browsers show from then on.'
              : 'Hermes couldn’t install the screen your agents’ browsers open on.'
      }
    >
      <div className="space-y-3 pt-3">
        {command && <CopyLine text={command} />}
        {failed?.line && !image && <p className="px-1 font-mono text-caption break-all text-ink-3">{failed.line}</p>}
      </div>
    </Sheet>
  )
}

function CopyLine({ text }: { text: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex items-center gap-1 rounded-lg bg-fill-2 py-1 pr-1 pl-3">
      {/* Wraps after a space, a slash or a colon, never mid-word. */}
      <code className="min-w-0 flex-1 font-mono text-footnote text-ink">
        {text.split(/(?<=[ /:])/).map((part, i) => (
          <Fragment key={i}>
            {i > 0 && <wbr />}
            <span className="whitespace-nowrap">{part}</span>
          </Fragment>
        ))}
      </code>
      <button
        type="button"
        onClick={() => void copy(text)}
        aria-label={copied ? 'Copied' : 'Copy'}
        className="pressable touch-target grid size-7 flex-none place-items-center rounded-md text-ink-3 hover:bg-fill-2 hover:text-ink"
      >
        {copied ? <Check size={15} strokeWidth={2.5} className="text-success" /> : <Copy size={15} strokeWidth={2} />}
      </button>
    </div>
  )
}
