type Key = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'getModifierState'>

/**
 * A key that puts something in a text field: a character, the first stroke of an accent or
 * of an input method, or a paste. ⌥ on a Mac types characters (@ on a German keyboard), as
 * AltGr does elsewhere, where Alt alone reaches for a menu. A message never starts with a
 * space, so that's left to the page.
 */
export function typesText(e: Key, mac: boolean) {
  // (Windows reports AltGr as Ctrl and Alt together.)
  const altGr = e.getModifierState('AltGraph')
  const ctrl = e.ctrlKey && !altGr
  const alt = e.altKey && !altGr
  if (mac ? e.metaKey && !ctrl : ctrl && !e.metaKey) return !alt && e.key.toLowerCase() === 'v'
  if (e.metaKey || ctrl || (alt && !mac)) return false
  return e.key === 'Dead' || e.key === 'Process' || (e.key !== ' ' && [...e.key].length === 1)
}
