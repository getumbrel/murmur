/**
 * How a code block is laid out. Long lines fold to fit the bubble, each
 * continuation tucked in under the line it belongs to, so nothing is hidden
 * off the side and it stays clear where one line ends and the next begins.
 * The one exception is anything drawn with characters (a boxed table, a
 * diagram): folding would wreck the picture, so that keeps its shape and
 * scrolls, the way a table does.
 */

const BOX_DRAWING = /[─-╿]/
// An ASCII rule such as +-----+-----+ or |-----|:---:|
const RULE = /^[ \t]*[+|][-=+|: \t]*[-=]{3,}[-=+|: \t]*$/m

/** True when the block is a picture made of characters, which must not fold. */
export const isDrawn = (code: string) => BOX_DRAWING.test(code) || RULE.test(code)

const TAB = 2 // matches tab-size in markdown.css
const DEEPEST = 12 // past this a folded line on a phone would have no room left

/** Where a folded line continues, in characters: just inside its own indentation. */
export function hang(line: string) {
  let indent = 0
  for (const ch of line) {
    if (ch === ' ') indent += 1
    else if (ch === '\t') indent += TAB
    else break
  }
  return Math.min(indent, DEEPEST) + 2
}

export type Token = { content: string; htmlStyle?: Record<string, string> }

/**
 * Pair every line of the code with whatever highlighting has caught up to it.
 * While streaming the highlighter lags, so a line may be fully coloured, partly
 * coloured with a plain remainder, or still plain.
 */
export function lines(code: string, highlighted?: Token[][]) {
  return code.split('\n').map((text, i) => {
    const tokens = highlighted?.[i] ?? []
    const done = tokens.reduce((n, t) => n + t.content.length, 0)
    const ok = done <= text.length && text.startsWith(tokens.map((t) => t.content).join(''))
    return { tokens: ok ? tokens : [], rest: ok ? text.slice(done) : text, hang: hang(text) }
  })
}
