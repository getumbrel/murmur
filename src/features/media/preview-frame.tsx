import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import { useMediaContext } from './context'
import { baseName, readText } from './files'

// A live HTML widget the agent wrote (::preview{file="…"}), inside the chat.
//
// Security: the page runs in an iframe with sandbox="allow-scripts" and no
// allow-same-origin, so it gets an opaque origin: no cookies, no storage, no
// access to Murmur or Hermes. It can only talk to us by postMessage, and we
// only listen to messages from its own window carrying its per-load token.
//
// Contract (Hermes's desktop hint, matched to Hermes Desktop):
//   - The theme arrives as CSS vars before the page's own styles:
//     --foreground, --muted-foreground, --accent, --border, --card, plus the
//     app font, zero margins and a transparent background.
//   - The frame takes the content's height live, and the width of the content's
//     first measured span.
//   - `data-hermes-send="prompt"` on anything clickable, or
//     `window.hermes.send("prompt")`, sends a hidden turn; the agent answers by
//     rewriting the file, which we re-read when the reply finishes.

const MIN_HEIGHT = 40
const MAX_HEIGHT = 1600
const SIZE = 'hermes-inline-preview-size'
const INTENT = 'hermes-inline-preview-intent'
const THEME = 'hermes-inline-preview-theme'

type Theme = { scheme: 'light' | 'dark'; vars: Record<string, string>; font: string }

function readTheme(el: Element): Theme {
  const css = getComputedStyle(el)
  const v = (name: string) => css.getPropertyValue(name).trim()
  // The page's own scheme: the system's, or the one Settings → Appearance forces.
  const scheme = getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'dark' : 'light'
  return {
    scheme,
    font: `${v('--font-sans') || 'system-ui, sans-serif'}`.replace(/'Inter Variable',?\s*/, ''),
    vars: {
      '--foreground': v('--ink'),
      '--muted-foreground': v('--ink-2'),
      '--accent': v('--accent'),
      '--accent-foreground': v('--accent-ink'),
      '--border': v('--line-strong'),
      '--card': v('--fill-1'),
      '--muted': v('--fill-2'),
      '--background': 'transparent',
      '--font-sans': v('--font-sans'),
      '--font-mono': v('--font-mono'),
    },
  }
}

const cssVars = (t: Theme) =>
  Object.entries(t.vars)
    .map(([k, val]) => `${k}:${val};`)
    .join('')

/** Theme first, so the page's own CSS wins wherever it sets something. */
function prelude(t: Theme) {
  return (
    `<meta name="color-scheme" content="${t.scheme}">` +
    `<style id="hermes-theme">:root{${cssVars(t)}color-scheme:${t.scheme}}</style>` +
    `<style>html,body{margin:0;padding:0;background:transparent;color:var(--foreground);` +
    `font-family:${t.font};font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;overflow:hidden}</style>`
  )
}

/** Sizing, the talk-back bridge, and live theme updates. Runs inside the frame. */
function bridge(token: string) {
  return `<script>(function(){
var T=${JSON.stringify(token)},lh=0,lw=0;
function size(){var d=document.documentElement,b=document.body;if(!b)return;
var h=Math.max(d.scrollHeight,b.scrollHeight),l=Infinity,r=0;
for(var i=0;i<b.children.length;i++){var c=b.children[i].getBoundingClientRect();if(c.width&&c.height){l=Math.min(l,c.left);r=Math.max(r,c.right)}}
var w=r>l?Math.ceil(r-l):0;if(Math.abs(h-lh)>1||Math.abs(w-lw)>1){lh=h;lw=w;parent.postMessage({type:"${SIZE}",token:T,height:h,width:w},"*")}}
function send(p){if(typeof p!=="string"||!p.trim())return false;parent.postMessage({type:"${INTENT}",token:T,prompt:p.slice(0,500)},"*");return true}
window.hermes={send:send};
addEventListener("click",function(e){var el=e.target&&e.target.closest?e.target.closest("[data-hermes-send]"):null;if(el){e.preventDefault();send(el.getAttribute("data-hermes-send")||"")}},true);
addEventListener("message",function(e){var m=e.data;if(e.source!==parent||!m||m.type!=="${THEME}"||m.token!==T)return;
var s=document.getElementById("hermes-theme");if(s)s.textContent=":root{"+m.css+"color-scheme:"+m.scheme+"}"});
if(window.ResizeObserver){var ro=new ResizeObserver(size);ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}
addEventListener("load",size);document.addEventListener("DOMContentLoaded",function(){size();if(window.ResizeObserver&&document.body)ro.observe(document.body)});size();
})()</script>`
}

function frameDoc(html: string, theme: Theme, token: string) {
  const script = bridge(token)
  const body = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : html + script
  // Prepend inside <head> when there is one, so a doctype stays first.
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, (m) => m + prelude(theme))
  if (/^\s*<!doctype[^>]*>/i.test(body)) return body.replace(/^\s*<!doctype[^>]*>/i, (m) => m + prelude(theme))
  return prelude(theme) + body
}

const newToken = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)

export function PreviewFrame({ file, className }: { file: string; className?: string }) {
  const { revision, onWidgetSend } = useMediaContext()
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [theme, setTheme] = useState<Theme | null>(null)

  // (Re-)read the file now, and whenever a reply finishes: the agent may have
  // rewritten it. Only a real change reloads the frame.
  useEffect(() => {
    let live = true
    readText(file).then(
      (f) => {
        if (!live) return
        if (f.binary || !f.text.trim()) return setError('This widget is empty.')
        setError(null)
        setHtml((prev) => (prev === f.text ? prev : f.text))
      },
      (e) =>
        live &&
        setHtml((prev) =>
          prev ? prev : (setError(e instanceof Error ? e.message : 'Couldn’t open this widget.'), null),
        ),
    )
    return () => {
      live = false
    }
  }, [file, revision])

  // The theme is read once per document; later changes are posted in.
  useEffect(() => {
    if (host.current) setTheme(readTheme(host.current))
  }, [])
  const token = useMemo(() => newToken(), [html])
  const ready = theme != null
  const doc = useMemo(() => (html && theme ? frameDoc(html, theme, token) : null), [html, token, ready])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      if (!host.current) return
      // Let the page's own tokens flip first.
      requestAnimationFrame(() => {
        const t = readTheme(host.current!)
        setTheme(t)
        frame.current?.contentWindow?.postMessage({ type: THEME, token, css: cssVars(t), scheme: t.scheme }, '*')
      })
    }
    media.addEventListener('change', update)
    window.addEventListener('murmur:theme', update)
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('murmur:theme', update)
    }
  }, [token])

  // Messages from the frame: size, and prompts it wants to send.
  const engaged = useRef(-Infinity)
  const lastSend = useRef(0)
  useEffect(() => {
    // A click inside the frame moves focus into it, which blurs our window:
    // that's how we know a person (not the page on its own) asked to send.
    const onBlur = () => {
      if (document.activeElement === frame.current) engaged.current = performance.now()
    }
    window.addEventListener('blur', onBlur)

    const onMessage = (e: MessageEvent) => {
      const el = frame.current
      const m = e.data as { type?: string; token?: string; height?: number; width?: number; prompt?: string } | null
      if (!el || e.source !== el.contentWindow || !m || m.token !== token) return
      if (m.type === SIZE) {
        const h = Number(m.height)
        if (Number.isFinite(h) && h > 0) {
          const next = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)))
          setHeight((prev) => (prev != null && Math.abs(prev - next) <= 2 ? prev : next))
        }
        const w = Math.round(Number(m.width))
        if (Number.isFinite(w) && w > 0) setWidth((prev) => prev ?? w)
      } else if (m.type === INTENT) {
        const prompt = String(m.prompt ?? '')
          .trim()
          .slice(0, 500)
        const now = performance.now()
        const touched = document.activeElement === el || now - engaged.current < 5000
        if (!prompt || !onWidgetSend || !touched || now - lastSend.current < 1000) return
        lastSend.current = now
        engaged.current = -Infinity
        // One send per interaction: hand focus back so the next needs a new tap.
        el.blur()
        Promise.resolve(onWidgetSend(prompt)).then((ok) => {
          if (!ok) toast('Wait for the reply to finish, then try again.')
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('blur', onBlur)
    }
  }, [token, onWidgetSend])

  const name = baseName(file)

  return (
    <div ref={host} className={cn('w-full', className)}>
      {error && !doc ? (
        <div className="rounded-lg bg-fill-1 px-4 py-3 text-footnote text-ink-3 ring-[0.5px] ring-line">
          <span className="font-medium text-ink-2">{name}</span> · {error}
        </div>
      ) : (
        <div
          className={cn(
            'relative max-w-full overflow-hidden rounded-md transition-[height] duration-200 ease-(--ease-out)',
            height == null && 'media-skeleton',
          )}
          style={{ height: height ?? 180, width: width ? `min(${width}px, 100%)` : '100%' }}
        >
          {doc && theme && (
            <iframe
              ref={frame}
              title={name}
              sandbox="allow-scripts"
              srcDoc={doc}
              loading="lazy"
              referrerPolicy="no-referrer"
              className={cn(
                'media-frame absolute inset-0 size-full transition-opacity duration-300',
                height == null ? 'opacity-0' : 'opacity-100',
              )}
              style={{ colorScheme: theme.scheme }}
            />
          )}
        </div>
      )}
    </div>
  )
}
