import { hermesOf } from '@/hermes/instance'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Ellipsis } from 'lucide-react'
import { Sheet } from '@/ui/sheet'
import { Button, IconButton } from '@/ui/button'
import { TextField } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { ChatGPTPanel } from '@/features/onboarding/connect'
import { signOutChatGPT, useChatGPTSignIn, useRefreshModels } from '@/state/models'
import {
  HELLO,
  VOICE_NAMES,
  afterRemoving,
  agentLanguage,
  checkVoiceKey,
  chooseVoice,
  deviceLanguage,
  hearSample,
  localPlace,
  pickVoice,
  removeVoiceKey,
  sampleVoice,
  useVoice,
  useVoiceRefresh,
  voiceRows,
  voiceSetupError,
  type VoiceChoice,
} from './voice-setup'
import { downloadLine, useLocalRefresh, useLocalVoice } from './local-voice'

type Saved = keyof typeof VOICE_NAMES
const NOTES: Record<VoiceChoice, string> = {
  local: 'Free, no account needed',
  chatgpt: 'Included with your plan',
  openai: 'About 5¢ a minute',
  elevenlabs: 'Most lifelike, billed by ElevenLabs',
}

const unfold = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { type: 'spring', duration: 0.32, bounce: 0 },
} as const

/**
 * How an agent talks. A tap switches to a voice and saves it in Hermes, and a voice that can speak
 * here says hello, so hearing it is the test that it works. Setup happens in the row.
 */
export function VoiceSheet({
  open,
  onOpenChange,
  profile,
  name,
  hue,
  provider,
  onStart,
  onChosen,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: string
  name: string
  hue: number
  /** The agent's own model's service: with nothing chosen, the voice a call would pick follows it. */
  provider?: string
  /** Opened by a call: the button starts it, with the voice just chosen. */
  onStart?: (from: { x: number; y: number }, choice?: VoiceChoice) => void
  /** Opened during a call: it moves to the voice chosen here, and nothing here makes a sound. */
  onChosen?: (choice: VoiceChoice) => void
}) {
  const voice = useVoice(open ? profile : undefined)
  const refresh = useVoiceRefresh()
  const language = voice.data ? agentLanguage(voice.data) : deviceLanguage()
  const local = useLocalVoice(open ? profile : undefined, language.id)
  const refreshLocal = useLocalRefresh()
  const [picked, setPicked] = useState<VoiceChoice>()
  const [setup, setSetup] = useState<VoiceChoice>()
  const [working, setWorking] = useState<VoiceChoice>()
  // `kept`: a replacement that didn't pass, which changed nothing, so the voice is as it was.
  const [failed, setFailed] = useState<{ id: VoiceChoice; message: string; kept?: boolean }>()
  const [keyText, setKeyText] = useState('')
  // The row showing what can be done with its key or sign-in, and whether it's asking first.
  const [manage, setManage] = useState<Saved>()
  const [asking, setAsking] = useState(false)
  // What just happened, in a line.
  const [note, setNote] = useState<string>()
  const refreshModels = useRefreshModels()
  const audio = useRef<HTMLAudioElement>(null)
  // Signing in only lends the voice the plan: the agent keeps thinking with its own model.
  const chatgpt = useChatGPTSignIn(hermesOf(profile), async () => {
    await chooseVoice(profile, 'chatgpt')
    await refresh(profile)
    setPicked('chatgpt')
    setSetup(undefined)
    onChosen?.('chatgpt')
  })

  // Nothing chosen yet: the one a call would pick by itself.
  const first = voice.data?.unset ? pickVoice(voice.data, provider)[0] : undefined
  const automatic = first === 'own' ? undefined : first

  // What Hermes has now is where the sheet starts.
  useEffect(() => {
    if (open && voice.data) setPicked((p) => p ?? voice.data.choice ?? automatic)
  }, [open, voice.data])
  useEffect(() => {
    if (open) return
    setPicked(undefined)
    setSetup(undefined)
    setFailed(undefined)
    setKeyText('')
    setManage(undefined)
    setAsking(false)
    setNote(undefined)
    audio.current?.pause()
  }, [open])

  // A local voice that finishes downloading while the sheet is open says hello in its new voice.
  const speaking = local.data?.on.speak ? local.data.active.speak : undefined
  const spoke = useRef(speaking)
  useEffect(() => {
    const before = spoke.current
    spoke.current = speaking
    if (open && !onChosen && picked === 'local' && before && speaking && before !== speaking) void say('local').catch(() => {})
  }, [speaking]) // eslint-disable-line react-hooks/exhaustive-deps

  const needsSetup = (id: VoiceChoice) => {
    const v = voice.data
    if (!v) return false
    return id === 'chatgpt' ? v.chatgpt === 'sign-in' : id !== 'local' && !v.keys[id]
  }

  const hasSaved = (id: VoiceChoice): id is Saved => {
    const v = voice.data
    if (!v || id === 'local') return false
    return id === 'chatgpt' ? v.chatgpt === 'ready' : v.saved[id]
  }

  const say = async (id: VoiceChoice) => {
    const url = await sampleVoice(profile, (HELLO[id === 'local' ? language.id : 'en'] ?? HELLO.en)(name))
    const el = audio.current
    if (el && !onChosen) {
      el.src = url
      await el.play().catch(() => {})
    }
    return url
  }

  const pick = async (id: VoiceChoice, key?: string) => {
    if (!voice.data) return
    setFailed(undefined)
    setManage(undefined)
    setNote(undefined)
    if (id !== 'chatgpt') chatgpt.cancel()
    if (!key && needsSetup(id)) return setSetup((s) => (s === id ? undefined : id))
    if (!key) setSetup(undefined)
    // Phones only play sound a tap starts: prime the element inside the tap.
    audio.current?.play().catch(() => {})
    setWorking(id)
    // A key replacing one that works has to pass first: saved, it can't be undone.
    if (key && id !== 'local' && id !== 'chatgpt' && voice.data.saved[id]) {
      try {
        await checkVoiceKey(id, key)
      } catch (e) {
        setFailed({ id, message: voiceSetupError(e, true, id === 'openai' ? 'OpenAI' : 'ElevenLabs'), kept: true })
        setWorking((w) => (w === id ? undefined : w))
        return
      }
    }
    setPicked(id)
    try {
      await chooseVoice(profile, id, { key, language })
      setSetup(undefined)
      setKeyText('')
      // The live voices only speak on a call.
      if (id === 'local' && !onChosen) await say(id)
      // A call hears through it too, so a key has to do both.
      if (id === 'elevenlabs') await hearSample(profile, await say(id))
      onChosen?.(id)
    } catch (e) {
      setFailed({ id, message: voiceSetupError(e, !!key) })
    } finally {
      setWorking((w) => (w === id ? undefined : w))
      void refresh(profile)
      if (id === 'local') void refreshLocal(profile)
    }
  }

  /** Takes the key or sign-in away. If it was the voice in use, the agent (and any call) moves off it. */
  const remove = async (id: Saved) => {
    setFailed(undefined)
    setAsking(false)
    setManage(undefined)
    setWorking(id)
    try {
      if (id === 'chatgpt') await signOutChatGPT(profile)
      else await removeVoiceKey(profile, id)
      const now = (await voice.refetch()).data
      if (!now) throw new Error('No voice')
      if (id === 'chatgpt') void refreshModels()
      if (id === 'chatgpt' && now.chatgpt === 'ready') return setFailed({ id, message: 'Still signed in, set up outside Murmur' })
      const { to, note } = afterRemoving(id, now, picked === id, name)
      if (to === 'local') {
        await chooseVoice(profile, 'local', { language })
        setPicked('local')
        onChosen?.('local')
      }
      if (to === 'none') setPicked(undefined)
      setNote(note)
    } catch {
      setFailed({ id, message: id === 'chatgpt' ? 'Couldn’t sign out, try again' : 'Couldn’t remove the key, try again' })
    } finally {
      setWorking((w) => (w === id ? undefined : w))
      void refresh(profile)
      void refreshLocal(profile)
    }
  }

  const rows = voiceRows(voice.data)
  const ready = !!picked && rows.includes(picked) && !working && !setup && (!failed || failed.kept) && !needsSetup(picked)

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Voice" className="hue-scope" style={{ '--hue': hue } as React.CSSProperties}>
      <audio ref={audio} hidden />
      <ListGroup>
        <AnimatePresence initial={false}>
          {rows.map((id) => {
            const on = picked === id && (failed?.id !== id || failed.kept) && !needsSetup(id)
            return (
              <motion.div key={id} {...unfold} className="relative overflow-hidden">
                <ListRow
                  className={cn(hasSaved(id) && 'pr-13')}
                  title={id === 'local' ? `On ${localPlace(local.data)}` : VOICE_NAMES[id]}
                  subtitle={
                    failed?.id === id ? (
                      failed.message
                    ) : (
                      <span className="tabular-nums">{(id === 'local' && downloadLine(local.data)) || NOTES[id]}</span>
                    )
                  }
                  detail={needsSetup(id) && setup !== id ? (id === 'chatgpt' ? 'Sign in' : 'Add key') : undefined}
                  trailing={
                    working === id ? (
                      <Spinner size={16} className="flex-none" />
                    ) : on ? (
                      <Check size={18} strokeWidth={2.5} className="flex-none text-accent" aria-label="In use" />
                    ) : undefined
                  }
                  onClick={() => void pick(id)}
                />
                {hasSaved(id) && (
                  <span className="absolute top-2.5 right-2.5 flex">
                    <IconButton
                      label={`${VOICE_NAMES[id]} ${id === 'chatgpt' ? 'sign-in' : 'key'}`}
                      size="sm"
                      className="text-ink-3"
                      aria-expanded={manage === id}
                      onClick={() => {
                        setAsking(false)
                        setSetup(undefined)
                        setManage((m) => (m === id ? undefined : id))
                      }}
                    >
                      <Ellipsis size={18} strokeWidth={2} />
                    </IconButton>
                  </span>
                )}
                <AnimatePresence initial={false}>
                  {manage === id && hasSaved(id) && (
                    <motion.div {...unfold} className="overflow-hidden">
                      {asking ? (
                        <div className="px-4 pt-1 pb-3">
                          <p className="text-footnote font-medium text-ink">{id === 'chatgpt' ? 'Sign out of ChatGPT?' : `Remove the ${VOICE_NAMES[id]} key?`}</p>
                          <p className="text-footnote text-ink-2">
                            {id === 'chatgpt'
                              ? 'All your agents lose your ChatGPT plan, for calls and for models, until you sign in again.'
                              : picked === id
                                ? rows.includes('local')
                                  ? `${name} will talk on ${localPlace(local.data)} instead.`
                                  : `${name} will need another voice.`
                                : `${name} can’t use ${VOICE_NAMES[id]} until you add a key again.`}
                          </p>
                          <div className="mt-2.5 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
                              Cancel
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => void remove(id)}>
                              {id === 'chatgpt' ? 'Sign out' : 'Remove'}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-4 pt-1 pb-3">
                          <p className="min-w-0 flex-1 truncate text-footnote text-ink-2">{id === 'chatgpt' ? 'Signed in' : `Key saved for ${name}`}</p>
                          {id !== 'chatgpt' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setManage(undefined)
                                setKeyText('')
                                setSetup(id)
                              }}
                            >
                              Replace
                            </Button>
                          )}
                          <Button size="sm" variant="danger" onClick={() => setAsking(true)}>
                            {id === 'chatgpt' ? 'Sign out' : 'Remove'}
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  )}
                  {setup === id && id === 'chatgpt' && (
                    <motion.div {...unfold} className="overflow-hidden">
                      <div className="px-4 pt-1 pb-4">
                        <ChatGPTPanel flow={chatgpt.flow} onStart={() => void chatgpt.start()} />
                      </div>
                    </motion.div>
                  )}
                  {setup === id && id !== 'chatgpt' && (
                    <motion.form
                      {...unfold}
                      className="overflow-hidden"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (keyText.trim() && !working) void pick(id, keyText)
                      }}
                    >
                      <div className="flex gap-2 px-4 pt-1 pb-3">
                        <TextField
                          autoFocus
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="API key"
                          aria-label={`${VOICE_NAMES[id as Saved]} key`}
                          value={keyText}
                          onChange={(e) => setKeyText(e.target.value)}
                          className="min-w-0 flex-1"
                        />
                        <Button type="submit" variant="accent" disabled={!keyText.trim() || working === id}>
                          Save
                        </Button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </ListGroup>
      <AnimatePresence initial={false}>
        {note && (
          <motion.p {...unfold} role="status" className="overflow-hidden">
            <span className="block px-4 pt-2.5 text-footnote text-ink-2">{note}</span>
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {onStart && ready && (
          <motion.div {...unfold} className="overflow-hidden">
            <div className="pt-4">
              <Button
                variant="accent"
                size="lg"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  onOpenChange(false)
                  onStart({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, picked)
                }}
              >
                Call {name}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}
