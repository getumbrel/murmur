import { createBundledHighlighter, type LanguageInput, type ThemeInput } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// Shiki, cut down to what people paste into a chat. @streamdown/code imports
// `shiki`, whose full bundle carries ~330 grammars and, as its default engine,
// the Oniguruma WASM (620 kB, shipped even though the plugin never used it). A
// Vite alias (vite.config.ts) points that import here instead: same exports,
// same shapes, so the plugin's streaming highlighter works unchanged.
//
// - Grammars load one at a time, the first time a block in that language
//   appears. Anything not listed renders as plain code, without an error.
// - Only the JavaScript regex engine: nothing to download or compile before
//   the first block paints. `forgiving` skips the odd pattern JS can't express
//   instead of failing the whole grammar.
// - Grammars come straight from @shikijs/langs, so one that another embeds
//   (html → css, js; php → sql, xml, …) is a single chunk, not a re-export
//   plus the chunk. xml, graphql and lua are listed because they ship anyway.

const languages: [id: string, load: LanguageInput, ...aliases: string[]][] = [
  ['javascript', () => import('@shikijs/langs/javascript'), 'js', 'cjs', 'mjs'],
  ['typescript', () => import('@shikijs/langs/typescript'), 'ts', 'cts', 'mts'],
  ['jsx', () => import('@shikijs/langs/jsx')],
  ['tsx', () => import('@shikijs/langs/tsx')],
  ['json', () => import('@shikijs/langs/json')],
  ['html', () => import('@shikijs/langs/html'), 'htm', 'xhtml'],
  ['css', () => import('@shikijs/langs/css')],
  ['shellscript', () => import('@shikijs/langs/shellscript'), 'bash', 'sh', 'shell', 'zsh', 'console'],
  ['python', () => import('@shikijs/langs/python'), 'py'],
  ['go', () => import('@shikijs/langs/go'), 'golang'],
  ['rust', () => import('@shikijs/langs/rust'), 'rs'],
  ['java', () => import('@shikijs/langs/java')],
  ['c', () => import('@shikijs/langs/c'), 'h'],
  ['cpp', () => import('@shikijs/langs/cpp'), 'c++', 'cc', 'cxx', 'hpp'],
  ['csharp', () => import('@shikijs/langs/csharp'), 'c#', 'cs'],
  ['php', () => import('@shikijs/langs/php')],
  ['ruby', () => import('@shikijs/langs/ruby'), 'rb'],
  ['swift', () => import('@shikijs/langs/swift')],
  ['kotlin', () => import('@shikijs/langs/kotlin'), 'kt', 'kts'],
  ['sql', () => import('@shikijs/langs/sql')],
  ['yaml', () => import('@shikijs/langs/yaml'), 'yml'],
  ['toml', () => import('@shikijs/langs/toml')],
  ['markdown', () => import('@shikijs/langs/markdown'), 'md'],
  ['diff', () => import('@shikijs/langs/diff'), 'patch'],
  ['docker', () => import('@shikijs/langs/docker'), 'dockerfile'],
  ['xml', () => import('@shikijs/langs/xml'), 'svg', 'plist'],
  ['graphql', () => import('@shikijs/langs/graphql'), 'gql'],
  ['lua', () => import('@shikijs/langs/lua')],
]

export const bundledLanguagesInfo = languages.map(([id, load, ...aliases]) => ({ id, name: id, aliases, import: load }))
export const bundledLanguages = Object.fromEntries(languages.map(([id, load]) => [id, load]))

export const bundledThemes: Record<string, ThemeInput> = {
  'github-light': () => import('@shikijs/themes/github-light'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
}

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
})
