// The agent's reasoning, as Hermes streams it (reasoning.delta). Some models
// write it in short titled sections, each opening with a line of its own in
// bold: ChatGPT's reasoning summaries ("**Checking the gateway logs**") and
// Gemini's thought summaries. Those titles say what the agent is doing in its
// own words, so while it thinks, the newest one stands in for "Thinking".
// Other models' reasoning is plain prose, with nothing to lift out.

/** A title line: the whole line in bold, or a Markdown heading. */
const TITLE = /^[ \t]*(?:\*\*([^*\n]+?)\*\*|#{1,4}[ \t]+([^\n#]+?))[ \t]*:?[ \t]*$/

/**
 * Titles that arrive with nothing between them, one to a line. ChatGPT often
 * sends titles alone, and Hermes doesn't always put a break between its
 * sections ("**Locating sources****Checking the visa site**"), or between a
 * section's last sentence and the next title ("…the logs.**Testing it**").
 */
const separate = (text: string) =>
  text.replace(/(\*\*[^*\n]+?\*\*)(?=\*)/g, '$1\n').replace(/([.!?…:)])(\*\*[^*\n]+?\*\*)(?=[ \t]*(?:\n|$|\*))/g, '$1\n\n$2')

/** A section title, or null for any other line. */
export function titleOf(line: string): string | null {
  const m = TITLE.exec(line)
  const title = (m?.[1] ?? m?.[2])?.trim().replace(/:$/, '')
  return title && title.length > 1 ? title : null
}

/**
 * The newest section's title, once it's written out in full. Null when the
 * reasoning has none (or none yet).
 */
export function currentTitle(text: string): string | null {
  const lines = separate(text).split('\n')
  // The last line may still be arriving: a title counts once its line is done,
  // or once its closing ** is in.
  for (let i = lines.length - 1; i >= 0; i--) {
    const title = titleOf(lines[i])
    if (title && (i < lines.length - 1 || /\*\*[ \t]*:?[ \t]*$/.test(lines[i]))) return title
  }
  return null
}

export type ReasoningLine = { title: boolean; text: string }

/**
 * The reasoning, line by line, to show as written: titles told apart, each
 * sitting right on top of its section, and bold marks dropped.
 */
export function reasoningLines(text: string): ReasoningLine[] {
  const lines: ReasoningLine[] = []
  for (const line of separate(text.trim()).split('\n')) {
    const title = titleOf(line)
    if (title) lines.push({ title: true, text: title })
    else if (line.trim() || !lines.at(-1)?.title) lines.push({ title: false, text: line.replace(/\*\*([^*\n]+)\*\*/g, '$1') })
  }
  return lines
}
