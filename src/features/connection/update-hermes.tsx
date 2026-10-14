import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/ui/button'
import { Buddy } from '@/ui/buddy'
import { ByUmbrel } from '@/ui/brand'
import { liftCurtain, type HermesConnection } from '@/state/connection'
import { WindowControlsGap } from '@/ui/titlebar'
import { HermesSwitcher, hostOf } from './switcher'
import { isBuiltinHermes, isUmbrelHermes, useOnUmbrel } from './hermes-connection-form'

/**
 * In front of the app when this browser's Hermes is too old for Murmur:
 * plainly why, how to fix it, and a way to another Hermes if there is one.
 */
export function UpdateHermes({ connection: c, onCheck }: { connection: HermesConnection; onCheck: () => Promise<unknown> }) {
  // Nothing else will draw, so a switch curtain lifts onto this.
  useEffect(liftCurtain, [])
  const [checking, setChecking] = useState(false)
  const name = c.name || hostOf(c.url)
  // Murmur's own Hermes is updated by updating Murmur.
  const builtin = isBuiltinHermes(c)
  const onUmbrel = useOnUmbrel()
  const umbrel = builtin ? onUmbrel : isUmbrelHermes(c) || /umbrel/i.test(hostOf(c.url))

  return (
    <main className="flex min-h-dvh flex-col bg-bg px-6 safe-top safe-bottom">
      <div className="flex h-14 items-center desktop:h-(--titlebar-h)">
        <WindowControlsGap side="start" />
        <HermesSwitcher />
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center pb-[8vh] text-center">
        <Buddy hue={278} size={88} state="offline" seed="update" label="" />
        <h1 className="mt-7 text-title font-semibold tracking-[-0.02em] text-balance">
          {builtin ? 'Murmur needs an update' : 'This Hermes needs an update'}
        </h1>
        <p className="mt-2 text-subhead text-ink-2 text-pretty">
          {builtin ? 'Its built-in Hermes is' : `${name} is running Hermes`} {c.hermesVersion ?? 'an older version'}. Murmur needs{' '}
          {c.minVersion ?? 'a newer version'} or newer.
        </p>
        <div className="mt-6 w-full rounded-xl bg-fill-1 px-4 py-3.5 text-left text-subhead text-ink-2">
          {builtin ? (
            umbrel ? (
              <>
                Open the <span className="font-medium text-ink">App Store</span> on your Umbrel, find{' '}
                <span className="font-medium text-ink">Murmur</span> and tap <span className="font-medium text-ink">Update</span>.
              </>
            ) : (
              'Pull the latest Murmur and restart it.'
            )
          ) : umbrel ? (
            <>
              On that Umbrel, open the <span className="font-medium text-ink">App Store</span>, find{' '}
              <span className="font-medium text-ink">Hermes Agent</span> and tap{' '}
              <span className="font-medium text-ink">Update</span>.
            </>
          ) : (
            <>
              On the computer running Hermes, run <code className="rounded-sm bg-fill-2 px-1 py-0.5 font-mono text-footnote text-ink">hermes update</code>, then restart it.
            </>
          )}
        </div>
        <Button
          size="lg"
          variant="accent"
          className="mt-6"
          loading={checking}
          onClick={async () => {
            setChecking(true)
            await onCheck().finally(() => setChecking(false))
          }}
        >
          <RefreshCw size={17} strokeWidth={2} aria-hidden />
          Check again
        </Button>
      </div>
      <ByUmbrel className="mx-auto pb-4" />
    </main>
  )
}
