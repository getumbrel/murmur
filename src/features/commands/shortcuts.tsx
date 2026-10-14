import { Fragment, useEffect } from 'react'
import { create } from 'zustand'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/lib/cn'
import { navigate, mainAgentId } from '@/lib/transitions'

// Keyboard shortcuts, for people with a keyboard. Every one is listed in the
// Shortcuts sheet ("?") and, where it makes sense, in the composer's command
// palette. ⌘ on a Mac, Ctrl everywhere else. While you're typing only the ⌘
// combos act (⌥↑/⌥↓ too, in an empty box, where they'd have nothing to move).

export const isMac =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent)

/** A key as its cap reads: symbols on a Mac, words elsewhere. */
const CAPS: Record<string, [mac: string, other: string]> = {
  mod: ['⌘', 'Ctrl'],
  shift: ['⇧', 'Shift'],
  alt: ['⌥', 'Alt'],
  enter: ['↵', 'Enter'],
  esc: ['esc', 'Esc'],
  up: ['↑', '↑'],
  down: ['↓', '↓'],
}

/** "mod+shift+o" → ['⌘', '⇧', 'O'] (or ['Ctrl', 'Shift', 'O']). */
export function caps(combo: string) {
  return combo.split('+').map((k) => CAPS[k]?.[isMac ? 0 : 1] ?? k.toUpperCase())
}

/** One string for a hint: "⌘⇧O" on a Mac, "Ctrl+Shift+O" elsewhere. */
export const hint = (combo: string) => caps(combo).join(isMac ? '' : '+')

type Shortcut = { title: string; keys: string[] }

/** Everything, as the sheet lists it. `keys` are alternatives ("⌘K or /"). */
const SECTIONS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { title: 'New chat', keys: ['mod+shift+o'] },
      { title: 'Search chats', keys: ['mod+k', '/'] },
      { title: 'Previous chat', keys: ['alt+up'] },
      { title: 'Next chat', keys: ['alt+down'] },
      { title: 'Settings', keys: ['mod+,'] },
      { title: 'Keyboard shortcuts', keys: ['?'] },
    ],
  },
  {
    title: 'In a chat',
    items: [
      { title: 'Send', keys: ['enter'] },
      { title: 'New line', keys: ['shift+enter'] },
      { title: 'Commands', keys: ['/'] },
      { title: 'Stop reply', keys: ['esc'] },
    ],
  },
]

// ── State ─────────────────────────────────────────────────────────────────────

const useSheet = create(() => ({ open: false }))
export const openShortcuts = () => useSheet.setState({ open: true })

let searchField: (() => void) | undefined
/** The search field ⌘K and "/" focus (the sidebar's, or Home's on a phone). */
export function registerSearch(focus: () => void) {
  searchField = focus
  return () => void (searchField === focus && (searchField = undefined))
}
export const focusSearch = () => searchField?.()

// ── Acting on them ────────────────────────────────────────────────────────────

const isField = (el: EventTarget | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

/** A field with something in it: arrows there move the caret, so they're not ours. */
const hasText = (el: HTMLElement) =>
  el.isContentEditable ? !!el.textContent : 'value' in el && String((el as HTMLInputElement).value) !== ''

/** A dialog other than the shortcuts sheet is up: keys belong to it. */
const otherDialog = () =>
  [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')].some(
    (d) => !d.closest('[data-shortcuts]'),
  )

/** New chat with the agent on screen, or the main one. */
export function newChat() {
  const m = /^\/(?:chat|agent)\/([^/]+)/.exec(location.pathname)
  const agent = m?.[1] ?? encodeURIComponent(mainAgentId())
  const to = `/chat/${agent}/new`
  if (location.pathname !== to) navigate(to)
  // Ready to type.
  requestAnimationFrame(() => requestAnimationFrame(() => focusComposer()))
}

const focusComposer = () => document.querySelector<HTMLTextAreaElement>('[role="main"] textarea, main textarea, textarea[aria-label="Message"]')?.focus()

/**
 * The sidebar's chats in the order you see them: each agent, or the chats
 * folded open beneath it in its place, and each group.
 */
function step(by: 1 | -1) {
  const bar = document.querySelector('[data-sidebar]')
  if (!bar) return false
  const shown = (a: Element) => !a.closest('[data-leaving]')
  const items = [...bar.querySelectorAll<HTMLAnchorElement>('a[data-nav]')].filter(
    (a) =>
      shown(a) &&
      (a.dataset.nav !== 'agent' ||
        a.getAttribute('aria-current') === 'page' ||
        ![...(a.closest('[data-nav-agent]')?.querySelectorAll('a[data-nav="chat"]') ?? [])].some(shown)),
  )
  if (!items.length) return false
  // The page you're on, else whatever the sidebar has highlighted.
  const here = items.findIndex((a) => a.getAttribute('href') === location.pathname)
  const at = here >= 0 ? here : items.findIndex((a) => a.getAttribute('aria-current') === 'page')
  const next = at < 0 ? (by > 0 ? items[0] : items[items.length - 1]) : items[at + by]
  if (!next) return true
  const href = next.getAttribute('href')
  if (href) navigate(href)
  next.scrollIntoView({ block: 'nearest' })
  return true
}

/** Listens for every app-wide shortcut. Mounted once, in the app shell. */
export function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      const key = e.key.toLowerCase()
      const sheet = useSheet.getState().open
      const run = (fn: () => void) => {
        e.preventDefault()
        if (sheet) useSheet.setState({ open: false })
        fn()
      }
      if (otherDialog() && !sheet) return

      // ⌘ combos work even mid-sentence.
      if (mod && e.shiftKey && !e.altKey && key === 'o') return run(newChat)
      if (mod && !e.shiftKey && !e.altKey && key === ',') return run(() => navigate('/settings'))

      // Everything else waits until you're not typing.
      const field = isField(e.target) ? e.target : undefined
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (field && hasText(field)) return
        if (step(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault()
        return
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !field) {
        e.preventDefault()
        useSheet.setState({ open: !sheet })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

// ── The sheet ─────────────────────────────────────────────────────────────────

export function ShortcutsSheet() {
  const open = useSheet((s) => s.open)
  return (
    <Sheet open={open} onOpenChange={(open) => useSheet.setState({ open })} title="Keyboard shortcuts" width={420}>
      <div data-shortcuts="" className="space-y-6 pb-1">
        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-2">
            <h3 className="px-4 text-footnote font-medium text-ink-2">{section.title}</h3>
            <dl className="list-group overflow-hidden rounded-xl bg-fill-1">
              {section.items.map((s) => (
                <div key={s.title} className="flex min-h-11 items-center gap-3 px-4 py-2">
                  <dt className="min-w-0 flex-1 truncate text-subhead text-ink">{s.title}</dt>
                  <dd className="flex flex-none items-center gap-1.5">
                    {s.keys.map((combo, i) => (
                      <Fragment key={combo}>
                        {i > 0 && <span className="text-caption text-ink-3">or</span>}
                        <Keys combo={combo} />
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  )
}

/** A combo as key caps, e.g. ⌘ ⇧ O. */
export function Keys({ combo, small, className }: { combo: string; small?: boolean; className?: string }) {
  const label = caps(combo)
  return (
    <kbd aria-label={label.join(' ')} className={cn('flex items-center font-sans', small ? 'gap-0.5' : 'gap-1', className)}>
      {label.map((k, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            'inline-flex items-center justify-center rounded-[6px] bg-fill-2 leading-none font-medium text-ink-2 tabular-nums',
            'shadow-[inset_0_-1px_0_var(--line)]',
            small ? 'h-4.5 min-w-4.5 px-1 text-[11px]' : 'h-6 min-w-6 px-1.5 text-footnote',
          )}
        >
          {k}
        </span>
      ))}
    </kbd>
  )
}
