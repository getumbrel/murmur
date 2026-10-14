import { useState, type FormEvent } from 'react'
import { motion, useAnimate } from 'motion/react'
import { Button } from '@/ui/button'
import { ByUmbrel } from '@/ui/brand'
import { usePrefersReducedMotion } from '@/lib/use-media'
import { BrandHeader } from './brand-header'
import { Note, PasswordField } from './fields'

// Murmur's own sign-in, shown only when the server has MURMUR_PASSWORD set
// (standalone installs). One field, one button. A wrong password shakes.

const HUE = 278

type Props = {
  /** Resolves true when signed in; false when the server said no (and `error` says why). */
  onSubmit: (password: string) => Promise<boolean>
  error?: string | null
  onEdit?: () => void
  /** Called once the success beat has played. */
  onSignedIn?: () => void
}

export function LoginScreen({ onSubmit, error, onEdit, onSignedIn }: Props) {
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  const [scope, animate] = useAnimate()
  const reduced = usePrefersReducedMotion()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || phase !== 'idle') return
    setPhase('busy')
    const ok = await onSubmit(password)
    if (ok) {
      setPhase('done')
      setTimeout(() => onSignedIn?.(), 650)
      return
    }
    setPhase('idle')
    if (!reduced) void animate(scope.current, { x: [0, -9, 8, -5, 3, 0] }, { duration: 0.42, ease: 'easeOut' })
    ;(scope.current as HTMLElement | null)?.querySelector('input')?.select()
  }

  return (
    <main className="flex min-h-dvh flex-col bg-bg safe-top md:justify-center md:py-12" style={{ '--hue': HUE } as React.CSSProperties}>
      {/* Laid out like Connect to Hermes: the same column, header and signature, so the two read as one place. */}
      <form onSubmit={submit} className="mx-auto w-full max-w-[30rem] flex-1 px-5 pt-14 md:flex-none md:pt-0">
        <motion.div
          initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Signed in: the two of them hop for joy before the app takes over. */}
          <BrandHeader hop={phase === 'done'} title="Sign in" body="Enter your password to continue." />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
          className="mt-9"
        >
          <div ref={scope}>
            <PasswordField
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) onEdit?.()
              }}
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              autoFocus
              invalid={!!error}
            />
          </div>
          <Note tone="danger">{error}</Note>
          <Button type="submit" size="lg" variant="accent" className="mt-4" loading={phase === 'busy'} disabled={!password && phase === 'idle'}>
            Continue
          </Button>
        </motion.div>
      </form>
      <footer className="flex justify-center pt-8 pb-[max(24px,env(safe-area-inset-bottom))] md:pb-0">
        <ByUmbrel />
      </footer>
    </main>
  )
}
