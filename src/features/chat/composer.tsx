import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowUp, PencilLine, Plus, Square, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMedia } from '@/lib/use-media'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'
import { TypeIcon } from '@/features/media/blocks'
import { formatSize } from '@/features/media/files'
import { CommandPalette, useCommandPalette } from '@/features/commands/command-palette'
import { parseCommand, type Command } from '@/features/commands/commands'
import { useAutoGrow, useDraft } from './use-draft'
import { DictationNote, DictationPanel, MicButton, canDictate, useDictation } from '@/features/voice/dictation'
import './composer.css'

export { useKeyboardInset } from './use-keyboard-inset'

/** Lets the screen hand files to the composer (e.g. dropped anywhere on the chat) or fill it in. */
export type ComposerHandle = {
  addFiles: (files: File[]) => void
  setText: (text: string) => void
  focus: () => void
}

type Props = {
  /** `files` are everything attached: images and any other file. */
  onSend: (text: string, files: File[]) => void
  onStop?: () => void
  busy?: boolean
  disabled?: boolean
  placeholder?: string
  /** Sits in the toolbar next to the attach button, e.g. a model picker. */
  accessory?: ReactNode
  autoFocus?: boolean
  /** Unsent text is kept per key (usually the chat id) across reloads. */
  draftKey?: string
  className?: string
  /** Accept any file, not just images. */
  files?: boolean
  handle?: Ref<ComposerHandle>
  /** Typing "/" offers these; sending "/name arg" calls `onCommand` instead of `onSend`. */
  commands?: Command[]
  /** More commands, offered once a name is being typed. */
  extraCommands?: Command[]
  /** Return false to keep the text (e.g. it wasn't a command after all). */
  onCommand?: (name: string, arg: string) => boolean | void
  /** Current choices for commands with options, e.g. { think: 'deep' }. */
  commandCurrent?: Record<string, string | undefined>
  /** Rewriting an earlier message: shows a pill to back out. */
  editing?: boolean
  onCancelEdit?: () => void
  /** Whether anything is typed, e.g. so the agent can look like it's listening. */
  onTypingChange?: (typing: boolean) => void
  /** Offers dictation (on secure pages), transcribed with this agent's speech settings. */
  voice?: string
}

type Attachment = { id: string; file: File; url?: string }

// Images go to the model natively (Hermes caps them at 25 MB); other files
// are read into the prompt, so keep them modest.
const MAX_IMAGE = 20 * 1024 * 1024
const MAX_FILE = 25 * 1024 * 1024
const MAX_COUNT = 10
const previewable = (f: File) => /^image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml)$/i.test(f.type)

const NO_COMMANDS: Command[] = []

// (Not crypto.randomUUID: it only exists in secure contexts, and Murmur is
// often opened over plain http, e.g. http://umbrel.local.)
let made = 0
const localId = () => `a${(made++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function Composer({
  onSend,
  onStop,
  busy = false,
  disabled = false,
  placeholder = 'Message',
  accessory,
  autoFocus,
  draftKey,
  className,
  files: anyFile = false,
  handle,
  commands,
  extraCommands,
  onCommand,
  commandCurrent,
  editing = false,
  onCancelEdit,
  onTypingChange,
  voice,
}: Props) {
  const [text, setText, clearDraft] = useDraft(draftKey)

  const [images, setImages] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const touch = useMedia('(pointer: coarse)')

  useAutoGrow(area, text)

  const latest = useRef(images)
  latest.current = images
  useEffect(() => () => latest.current.forEach((a) => a.url && URL.revokeObjectURL(a.url)), [])

  const addImages = (incoming: File[]) => {
    const files = anyFile ? incoming : incoming.filter((f) => f.type.startsWith('image/'))
    if (!files.length) {
      if (incoming.length) toast('Only photos can be added here.')
      return
    }
    const ok: File[] = []
    for (const f of files) {
      const limit = previewable(f) ? MAX_IMAGE : MAX_FILE
      if (f.size > limit) toast(`“${f.name}” is too large. Files can be up to ${formatSize(limit)}.`)
      else if (f.size === 0) toast(`“${f.name}” is empty.`)
      else ok.push(f)
    }
    const room = MAX_COUNT - latest.current.length
    if (ok.length > room) toast(`You can attach up to ${MAX_COUNT} files at a time.`)
    const take = ok.slice(0, Math.max(0, room))
    if (!take.length) return
    setImages((list) => [
      ...list,
      ...take.map((file) => ({
        id: localId(),
        file,
        url: previewable(file) ? URL.createObjectURL(file) : undefined,
      })),
    ])
    area.current?.focus({ preventScroll: true })
  }
  const removeImage = (id: string) =>
    setImages((list) => {
      const gone = list.find((a) => a.id === id)
      if (gone?.url) URL.revokeObjectURL(gone.url)
      return list.filter((a) => a.id !== id)
    })
  const focus = () => {
    const el = area.current
    if (!el) return
    el.focus({ preventScroll: true })
    // Caret at the end, after whatever was just put there.
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
  }
  useImperativeHandle(handle, () => ({
    addFiles: (files) => addImages(files),
    setText: (next) => setText(next),
    focus,
  }))

  const typing = text.trim().length > 0
  const reportTyping = useRef(onTypingChange)
  reportTyping.current = onTypingChange
  useEffect(() => reportTyping.current?.(typing), [typing])
  useEffect(() => () => reportTyping.current?.(false), [])

  const palette = useCommandPalette({
    text,
    setText: (next) => {
      setText(next)
      focus()
    },
    commands: commands ?? NO_COMMANDS,
    extra: extraCommands,
    onRun: (name, arg) => onCommand?.(name, arg),
    current: commandCurrent,
  })
  const paletteId = useId()

  // Talk instead of type: the words land here to look over, never sent by themselves.
  const [micOk] = useState(canDictate)
  const dictation = useDictation({
    profile: voice,
    onText: (words) => {
      setText(words)
      focus()
    },
  })

  const hasContent = text.trim().length > 0 || images.length > 0
  const mode: 'send' | 'stop' | 'mic' =
    busy && !hasContent ? 'stop' : !hasContent && voice !== undefined && micOk && !editing ? 'mic' : 'send'

  const send = () => {
    if (disabled || !hasContent) return
    const command = onCommand && !images.length ? parseCommand(text) : null
    if (command) {
      if (onCommand?.(command.name, command.arg) === false) return
      clearDraft()
      return
    }
    haptic()
    onSend(
      text.trim(),
      images.map((a) => a.file),
    )
    // (The thread keeps its own previews; ours can go.)
    images.forEach((a) => a.url && URL.revokeObjectURL(a.url))
    setImages([])
    clearDraft()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (palette.onKeyDown(e)) return
    if (e.key === 'Escape' && editing && onCancelEdit) {
      e.preventDefault()
      return onCancelEdit()
    }
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (touch && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    send()
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files]
    if (!files.length) return
    e.preventDefault()
    addImages(files)
  }

  const onDrop = (e: DragEvent) => {
    // (The chat's drop zone sees this was handled and stands down.)
    e.preventDefault()
    setDragging(false)
    addImages([...e.dataTransfer.files])
  }

  const field = (
    <textarea
      ref={area}
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={editing ? 'Edit your message' : 'Message'}
      enterKeyHint={touch ? 'enter' : 'send'}
      role={commands ? 'combobox' : undefined}
      aria-expanded={commands ? palette.open : undefined}
      aria-controls={commands && palette.open ? paletteId : undefined}
      aria-activedescendant={commands && palette.open ? `${paletteId}-${palette.index}` : undefined}
      aria-autocomplete={commands ? 'list' : undefined}
      className={cn(
        // A long agent name ends in … on one line rather than growing the field.
        'block resize-none bg-transparent text-body text-ink outline-none placeholder:truncate placeholder:text-ink-3 disabled:opacity-50',
        accessory ? 'w-full px-4.5 pt-3.5 pb-1' : 'min-w-0 flex-1 px-1 py-1.5',
      )}
    />
  )

  const attach = (
    <button
      type="button"
      onClick={() => picker.current?.click()}
      disabled={disabled}
      aria-label={anyFile ? 'Add photos or files' : 'Add images'}
      title={anyFile ? 'Add photos or files' : 'Add images'}
      className="pressable relative flex size-9 flex-none items-center justify-center rounded-full text-ink-2 hover:bg-fill-2 hover:text-ink disabled:opacity-40 after:absolute after:-inset-1"
    >
      <Plus size={20} strokeWidth={1.75} />
    </button>
  )

  const submit =
    mode === 'mic' ? (
      <MicButton dictation={dictation} disabled={disabled} />
    ) : (
      <button
        type="button"
        onClick={mode === 'stop' ? onStop : send}
        disabled={disabled || (mode === 'send' && !hasContent) || (mode === 'stop' && !onStop)}
        aria-label={mode === 'stop' ? 'Stop' : 'Send'}
        title={mode === 'stop' ? 'Stop' : 'Send'}
        className={cn(
          'pressable relative flex size-9 flex-none items-center justify-center rounded-full transition-colors duration-200 after:absolute after:-inset-1',
          'disabled:bg-fill-3 disabled:text-ink-3',
          mode === 'stop' ? 'bg-ink text-bg' : 'bg-accent text-accent-ink',
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={mode}
            initial={{ scale: 0.4, opacity: 0, rotate: mode === 'stop' ? -90 : 0 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 30 }}
            className="flex"
          >
            {mode === 'stop' ? (
              <Square size={12} fill="currentColor" strokeWidth={0} />
            ) : (
              <ArrowUp size={19} strokeWidth={2.25} />
            )}
          </motion.span>
        </AnimatePresence>
      </button>
    )

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('px-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:px-6 sm:pb-6', className)}>
        <div className="relative">
          {commands && <CommandPalette state={palette} id={paletteId} />}
          <div
            className="composer glass relative rounded-[26px] shadow-float"
            data-busy={busy || undefined}
            data-dragging={dragging || undefined}
            data-dictating={dictation.active || undefined}
            onDragOver={(e) => {
              if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
            }}
            onDrop={onDrop}
          >
            <span aria-hidden className="composer-rim" />

            <AnimatePresence initial={false}>
              {editing && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', duration: 0.32, bounce: 0 }}
                  className="overflow-hidden"
                >
                  {/* The pill lines up with the + below it; its pencil, with the words you type. */}
                  <div className="flex px-2 pt-2">
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent-soft pr-1 pl-2.5 text-footnote font-medium text-accent select-none">
                      <PencilLine size={13} strokeWidth={2.25} aria-hidden />
                      Editing message
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        aria-label="Stop editing"
                        title="Stop editing"
                        className="pressable relative ml-0.5 flex size-5 items-center justify-center rounded-full hover:bg-accent/15 after:absolute after:-inset-2.5"
                      >
                        <X size={13} strokeWidth={2.5} />
                      </button>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <DictationNote dictation={dictation} />

            <AnimatePresence initial={false}>
              {images.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                  className="overflow-hidden"
                >
                  <ul className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3" aria-label="Attachments">
                    <AnimatePresence initial={false}>
                      {images.map((a) => (
                        <motion.li
                          key={a.id}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                          className="relative flex-none"
                        >
                          {a.url ? (
                            <img
                              src={a.url}
                              alt={a.file.name}
                              className="size-16 rounded-md object-cover ring-[0.5px] ring-line-strong"
                            />
                          ) : (
                            <div className="flex h-16 w-52 items-center gap-2.5 rounded-md bg-fill-1 pr-3 pl-2.5 ring-[0.5px] ring-line-strong">
                              <TypeIcon path={a.file.name} className="size-10" />
                              <div className="min-w-0">
                                <p className="truncate text-footnote font-medium text-ink">{a.file.name}</p>
                                <p className="truncate text-caption text-ink-3">{formatSize(a.file.size)}</p>
                              </div>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => removeImage(a.id)}
                            aria-label={`Remove ${a.file.name}`}
                            className="pressable absolute -top-1.5 -right-1.5 flex size-5.5 items-center justify-center rounded-full bg-ink text-bg ring-2 ring-elevated after:absolute after:-inset-2.5"
                          >
                            <X size={12} strokeWidth={2.5} />
                          </button>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>

            {accessory ? (
              <>
                {field}
                <div className="flex items-center gap-0.5 px-2 pt-1 pb-2">
                  {attach}
                  {accessory}
                  <div className="flex-1" />
                  {submit}
                </div>
              </>
            ) : (
              <div className="flex items-end gap-1 p-2">
                {attach}
                {field}
                {submit}
              </div>
            )}

            <DictationPanel dictation={dictation} roomy={!!accessory} />

            <input
              ref={picker}
              type="file"
              accept={anyFile ? undefined : 'image/*'}
              multiple
              hidden
              onChange={(e) => {
                addImages([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}
