import { Fragment, useState, type FormEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/ui/button'
import { SecretField } from '@/ui/field'
import { BrowserIcon } from '@/ui/icons'
import { ListGroup, ListRow } from '@/ui/list'
import { Sheet } from '@/ui/sheet'
import { Toggle } from '@/ui/toggle'
import { cn } from '@/lib/cn'
import { useCopy } from '@/features/chat/use-copy'
import { useHermesConnection } from '@/state/connection'
import { Tile } from '@/features/settings/page'
import { Swap } from '@/features/settings/swap'
import { installScreen, showBrowsers, useBrowsersShown, useHostScreen, useInstall, useScreens } from '@/state/screen'

const LABEL = 'Show agents’ browsers'

/**
 * "Show agents' browsers", for Settings → Agents: one switch for every agent,
 * only where its Hermes can show them (a Linux host). On one without the
 * screen yet, switching it on sets it up first, with Hermes's own installer:
 * once, about 200 MB, asking for the server's password if it needs one.
 */
export function BrowsersRow({ agentIds }: { agentIds: string[] }) {
  const screen = useHostScreen()
  const shown = useBrowsersShown()
  const install = useInstall((s) => s.default) ?? { phase: 'idle' }
  const [saving, setSaving] = useState<boolean>()
  const [help, setHelp] = useState(false)
  if (!screen?.supported) return null

  const change = async (on: boolean) => {
    if (saving !== undefined || install.phase === 'running' || install.phase === 'password') return
    setSaving(on)
    try {
      if (on && !screen.installed) {
        await installScreen()
        if (!useScreens.getState().screens.default?.installed) return setHelp(true)
      }
      await showBrowsers(on, agentIds)
    } catch {
      toast.error('Couldn’t change that. Try again.')
    } finally {
      setSaving(undefined)
    }
  }

  const status =
    install.phase === 'running'
      ? { id: 'installing', text: 'Setting up on your server…', busy: true }
      : install.phase === 'password'
        ? { id: 'password', text: 'Waiting for your server’s password', busy: true }
        : saving !== undefined
          ? saving
            ? { id: 'on', text: 'Setting up your agents…', busy: true }
            : { id: 'off', text: 'Turning off…', busy: true }
          : install.phase === 'failed'
            ? { id: 'failed', text: 'Couldn’t set it up. Tap to see how.' }
            : shown && screen.blocker
              ? { id: 'memory', text: 'Your server is short of memory right now' }
              : !screen.installed
                ? { id: 'once', text: 'Sets up once, about 200 MB' }
                : undefined
  const checked = saving ?? (!!shown && screen.installed)

  return (
    <>
      <ListGroup
        footer={
          'Watch an agent’s browser live in the chat while it works, and take over when it needs a hand, ' +
          'like for a code or a check that you’re human.'
        }
      >
        <ListRow
          icon={
            <Tile>
              <BrowserIcon size={19} />
            </Tile>
          }
          title={LABEL}
          subtitle={
            status && (
              <Swap id={status.id}>
                <span className={cn(status.busy && 'text-shimmer')}>{status.text}</span>
              </Swap>
            )
          }
          onClick={install.phase === 'failed' ? () => setHelp(true) : undefined}
          trailing={
            <span className={cn('flex w-[51px] flex-none', status?.busy && 'pointer-events-none')}>
              {shown === undefined ? (
                // Still asking Hermes: a switch that's plainly there but not ready yet.
                <span inert className="opacity-40 motion-safe:animate-pulse" aria-hidden>
                  <Toggle checked={false} onChange={() => {}} label={LABEL} />
                </span>
              ) : (
                <span className="animate-fade">
                  <Toggle checked={checked} onChange={(on) => void change(on)} label={LABEL} />
                </span>
              )}
            </span>
          }
        />
      </ListGroup>
      <PasswordSheet />
      <HowSheet open={help && install.phase === 'failed'} onOpenChange={setHelp} />
    </>
  )
}

/** Hermes asking for the server's password to install the screen: it goes to Hermes, and nowhere else. */
function PasswordSheet() {
  const install = useInstall((s) => s.default)
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
 * then switch it on again. A Hermes in a container has no way to install
 * anything, so there it's the image that has the screen: Nous's desktop one.
 */
function HowSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const install = useInstall((s) => s.default)
  const failed = install?.phase === 'failed' ? install : undefined
  const hermes = useHermesConnection().connection
  const image = failed?.unprivileged && hermes?.fromImage
  const command = image
    ? hermes.hermesVersion && `nousresearch/hermes-agent:v${hermes.hermesVersion}-desktop`
    : failed?.command
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={image ? 'Use Hermes’s desktop image' : 'Set it up on your server'}
      description={
        image
          ? 'Your Hermes runs in a container that can’t add the screen itself. Start it from Nous’s desktop image, which comes with it, then switch this on again.'
          : failed?.unprivileged && command
            ? 'Hermes can’t install the screen your agents’ browsers open on: it has no sudo there. Run this as root on your server, then switch it on again.'
            : command
              ? 'Hermes couldn’t install the screen your agents’ browsers open on. Run this on your server, then switch it on again.'
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
