import { isValidElement, memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Streamdown,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  useIsCodeFenceIncomplete,
  type Components,
} from 'streamdown'
import { Check, Copy } from 'lucide-react'
import { useCopy } from './use-copy'
import { HostImage, RemoteImage } from '@/features/media/blocks'
import { useMediaContext } from '@/features/media/context'
import { Mention, useMentions } from './mention'
import { rehypeMentions } from './rehype-mentions'
import type { Pluggable } from 'unified'
import 'streamdown/styles.css'
import './markdown.css'

// Shiki is heavy: load the highlighter only once a code block appears.
type CodePlugin = typeof import('@streamdown/code').code
type Token = { content: string; htmlStyle?: Record<string, string> }
let plugin: Promise<CodePlugin> | undefined
const loadPlugin = () => (plugin ??= import('@streamdown/code').then((m) => m.code))
const THEMES: ['github-light', 'github-dark'] = ['github-light', 'github-dark']

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

function useHighlight(code: string, language: string, incomplete: boolean) {
  const [result, setResult] = useState<{ code: string; tokens: Token[][] } | null>(null)
  useEffect(() => {
    let live = true
    loadPlugin().then((p) => {
      if (!live) return
      const done = (r: { tokens: Token[][] }) => live && setResult({ code, tokens: r.tokens })
      const sync = p.highlight({ code, language: language as never, themes: THEMES, isIncomplete: incomplete }, done)
      if (sync) done(sync)
    })
    return () => {
      live = false
    }
  }, [code, language, incomplete])
  return result
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const language = /language-([^\s]+)/.exec(className ?? '')?.[1] ?? ''
  const code = textOf(children).replace(/\n$/, '')
  const incomplete = useIsCodeFenceIncomplete()
  const result = useHighlight(code, language || 'text', incomplete)
  const { copied, copy } = useCopy()

  // While streaming the highlight lags a token or two behind; paint what's
  // highlighted and show the fresh tail as plain text so nothing flickers.
  const fresh = result && code.startsWith(result.code) ? result : null
  const tail = fresh ? code.slice(fresh.code.length) : code

  return (
    <div className="md-code" data-streamdown="code-block">
      <div className="md-code-head">
        <span>{language || 'code'}</span>
        <button
          type="button"
          className="md-code-copy pressable"
          onClick={() => copy(code)}
          aria-label={copied ? 'Copied' : 'Copy code'}
          disabled={incomplete}
        >
          {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        <code>
          {fresh?.tokens.map((line, i) => (
            <span key={i} className="md-line">
              {line.map((t, j) => (
                <span key={j} style={t.htmlStyle as CSSProperties}>
                  {t.content}
                </span>
              ))}
              {i < fresh.tokens.length - 1 && '\n'}
            </span>
          ))}
          {tail}
        </code>
      </pre>
    </div>
  )
}

type El = { children?: ReactNode; className?: string; node?: unknown }
const strip = <P extends El>({ node: _node, className: _className, ...rest }: P) => rest

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code: (props) => <CodeBlock className={props.className} children={props.children} />,
  inlineCode: ({ children }) => <code className="md-inline">{children}</code>,
  table: (props) => (
    <div className="md-table">
      <table {...strip(props)} />
    </div>
  ),
  img: ({ src, alt }) => <MarkdownImage src={typeof src === 'string' ? src : ''} alt={alt ?? ''} />,
  p: (props) => <p {...strip(props)} />,
  ul: (props) => <ul {...strip(props)} />,
  ol: ({ start, ...props }) => <ol start={start} {...strip(props)} />,
  li: (props) => <li {...strip(props)} />,
  blockquote: (props) => <blockquote {...strip(props)} />,
  hr: () => <hr />,
  h1: (props) => <h3 {...strip(props)} />,
  h2: (props) => <h3 {...strip(props)} />,
  h3: (props) => <h4 {...strip(props)} />,
  h4: (props) => <h5 {...strip(props)} />,
  h5: (props) => <h5 {...strip(props)} />,
  h6: (props) => <h5 {...strip(props)} />,
  th: (props) => <th {...strip(props)} />,
  td: (props) => <td {...strip(props)} />,
  thead: (props) => <thead {...strip(props)} />,
  tbody: (props) => <tbody {...strip(props)} />,
  tr: (props) => <tr {...strip(props)} />,
  strong: (props) => <strong {...strip(props)} />,
  // From rehypeMentions: an agent's id, or '' for @everyone.
  mention: (props) => <Mention agentId={String(props['data-agent'] ?? '')} children={props.children as ReactNode} />,
}

/** Remote images load as they are; a path on the Hermes host goes through its file API. */
function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const { sessionId, profile } = useMediaContext()
  if (/^(?:file:|\/(?!hermes\/)|~\/)/i.test(src)) {
    const path = src.startsWith('file:') ? decodeURIComponent(src.replace(/^file:\/\//i, '')) : src
    return <HostImage fileRef={{ path, sessionId, profile }} alt={alt} />
  }
  if (/^(?:https?:|data:image\/)/i.test(src)) return <RemoteImage src={src} alt={alt} />
  return null
}

// New words rise in: ~140ms of opacity and a 2px lift (`sd-murmur` in markdown.css), gently staggered.
const animation = {
  animation: 'murmur',
  duration: 140,
  easing: 'cubic-bezier(.16,1,.3,1)',
  sep: 'word',
  stagger: 16,
  maxBacklogMs: 160,
} as const
const off = { enabled: false }

type MdNode = { type: string; value?: string; children?: MdNode[] }

/** A single line break stays a line break, the way people write in chat (addresses, poems, lists without bullets). */
function breaks() {
  const walk = (node: MdNode) => {
    if (!node.children) return
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'text' || !child.value?.includes('\n')) {
        walk(child)
        return [child]
      }
      return child.value
        .split(/\r?\n/)
        .flatMap((value, i): MdNode[] => (i ? [{ type: 'break' }, { type: 'text', value }] : [{ type: 'text', value }]))
    })
  }
  return walk
}
const remarkPlugins = [...Object.values(defaultRemarkPlugins), breaks]
const rehypeDefaults = Object.values(defaultRehypePlugins)

/** Assistant prose. Streams smoothly: blocks are memoised and new words fade in. */
export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  // @mentions become chips once we know who can be mentioned. (Streamdown
  // keeps its parse when only plugins change, so a new roster remounts it.)
  const { members, key } = useMentions()
  const rehypePlugins = useMemo(
    () => (members.length ? [...rehypeDefaults, [rehypeMentions, { members }] satisfies Pluggable] : undefined),
    [members],
  )
  // Saved replies are whole markdown, parsed in one go: streaming's renderer
  // re-reads each block as if it might still be open, which made long chats
  // slow to open. One that's streaming keeps that renderer while it's shown,
  // since switching as it finished would draw it all again.
  const [mode] = useState<'streaming' | 'static'>(streaming ? 'streaming' : 'static')
  return (
    <Streamdown
      key={key}
      className={streaming ? 'md md-streaming' : 'md'}
      mode={mode}
      isAnimating={streaming}
      animated={animation}
      components={components}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      controls={false}
      linkSafety={off}
      lineNumbers={false}
    >
      {text}
    </Streamdown>
  )
})
