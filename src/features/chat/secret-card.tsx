import { memo, useRef, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { Check, Clock, LockKeyhole, Minus } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'
import { SecretField, TextField } from '@/ui/field'
import { cn } from '@/lib/cn'
import type { ChatItem } from './types'
import { Swap, arrive } from './collapse'

type Item = Extract<ChatItem, { kind: 'secret' }>

/**
 * Hermes asking for something it must never see in the conversation: a login
 * to keep in its vault, a one-time code, or a key a skill needs. Typed into a
 * masked field and handed straight back; the chat only keeps the receipt.
 */
export const SecretCard = memo(function SecretCard({
  item,
  name,
  hue,
  seed,
  onSecret,
}: {
  item: Item
  /** Who's asking, for the card's words. */
  name?: string
  hue: number
  seed?: string
  onSecret?: (requestId: string, value: string) => void
}) {
  const pending = item.status === 'pending'
  const watched = useRef(pending)
  return (
    <Swap id={pending ? 'card' : 'receipt'}>
      {pending && onSecret ? (
        <Card item={item} name={name} hue={hue} seed={seed} onSecret={onSecret} />
      ) : (
        <Receipt item={item} fresh={watched.current} />
      )}
    </Swap>
  )
})

function copyFor(item: Item, who = 'Your agent') {
  const site = item.site ?? 'this site'
  switch (item.ask) {
    case 'login':
      return {
        title: `Save your login for ${site}`,
        lead: `${who} will sign in with it, now and next time, without ever seeing your password.`,
        note: 'Kept in your agent’s vault, never in this chat.',
        send: 'Save',
        skip: 'Not now',
      }
    case 'code':
      return {
        title: item.site ? `Enter the code for ${item.site}` : 'Enter your sign-in code',
        lead: item.prompt ?? 'From your authenticator app, a text or an email.',
        note: 'Goes straight to the page, never into this chat.',
        send: 'Enter',
        skip: 'Skip',
      }
    case 'key':
      return {
        title: item.prompt ?? 'Add a key',
        lead: item.help ?? (item.skill ? `${who} needs it to use ${item.skill}.` : undefined),
        note: 'Kept in your agent’s settings, never in this chat.',
        send: 'Save',
        skip: 'Skip',
      }
  }
}

function Card({
  item,
  name,
  hue,
  seed,
  onSecret,
}: {
  item: Item
  name?: string
  hue: number
  seed?: string
  onSecret: (id: string, value: string) => void
}) {
  const copy = copyFor(item, item.speaker?.name ?? name)
  const [identifier, setIdentifier] = useState('')
  const [value, setValue] = useState('')
  const [sent, setSent] = useState<'send' | 'skip'>()
  const login = item.ask === 'login'
  const ready = !!value.trim() && (!login || !!identifier.trim())

  const answer = (how: 'send' | 'skip') => {
    if (sent) return
    setSent(how)
    const out =
      how === 'skip' ? '' : login ? JSON.stringify({ identifier: identifier.trim(), password: value }) : value.trim()
    // Gone from here the moment it's sent.
    setIdentifier('')
    setValue('')
    onSecret(item.requestId, out)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready) answer('send')
  }

  return (
    <motion.form
      {...arrive}
      onSubmit={submit}
      aria-label={copy.title}
      autoComplete="off"
      className="rounded-xl bg-elevated p-4 shadow-[inset_0_0_0_0.5px_var(--line-strong)]"
    >
      <div className="flex items-center gap-3">
        <Orb hue={hue} size={28} state="waiting" seed={seed} />
        <h3 className="min-w-0 flex-1 text-subhead font-semibold tracking-[-0.01em] wrap-break-word">{copy.title}</h3>
      </div>
      {copy.lead && <p className="mt-2 text-footnote text-ink-2 wrap-break-word">{copy.lead}</p>}

      <div className="mt-3 space-y-2">
        {login && (
          <TextField
            aria-label="Email or username"
            placeholder="Email or username"
            className="h-11"
            value={identifier}
            disabled={!!sent}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
          />
        )}
        {item.ask === 'code' ? (
          <TextField
            aria-label="Code"
            placeholder="Code"
            className="h-11 font-mono tracking-[0.2em] placeholder:font-sans placeholder:tracking-normal"
            value={value}
            disabled={!!sent}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        ) : (
          <SecretField
            className="h-11"
            aria-label={login ? 'Password' : 'Key'}
            placeholder={login ? 'Password' : 'Paste the key'}
            value={value}
            disabled={!!sent}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-ink-3">
          <LockKeyhole size={12} strokeWidth={2} aria-hidden className="flex-none" />
          <span className="min-w-0">{copy.note}</span>
        </p>
        {/* Like the permission card: full-width answers under the thumb on phones. */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="h-11 w-full whitespace-nowrap sm:h-10 sm:w-auto"
            disabled={sent === 'send'}
            loading={sent === 'skip'}
            onClick={() => answer('skip')}
          >
            {copy.skip}
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="h-11 w-full whitespace-nowrap sm:h-10 sm:w-auto sm:min-w-20"
            disabled={!ready || sent === 'skip'}
            loading={sent === 'send'}
          >
            {copy.send}
          </Button>
        </div>
      </div>
    </motion.form>
  )
}

const RECEIPT = {
  login: { sent: 'Login saved', skipped: 'Login not saved' },
  code: { sent: 'Code entered', skipped: 'No code entered' },
  key: { sent: 'Key saved', skipped: 'Key not added' },
} as const

function Receipt({ item, fresh }: { item: Item; fresh: boolean }) {
  const sent = item.status === 'sent'
  const label = item.status === 'expired' || item.status === 'pending' ? 'Timed out' : RECEIPT[item.ask][item.status]
  const about = item.ask === 'key' ? (item.skill ?? item.prompt) : item.site
  const Icon = item.status === 'sent' ? Check : item.status === 'skipped' ? Minus : Clock
  return (
    <p
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 text-footnote text-ink-3',
        fresh && sent && 'receipt-tint -mx-2 px-2',
      )}
    >
      <Icon size={14} strokeWidth={2} aria-hidden className={cn('flex-none', sent && 'text-success')} />
      <span className="flex-none text-ink-2">{label}</span>
      {about && (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">{about}</span>
        </>
      )}
    </p>
  )
}
