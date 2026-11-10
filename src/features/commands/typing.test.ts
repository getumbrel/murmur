import { describe, expect, it } from 'vitest'
import { typesText } from './typing'

const key = (key: string, held: { ctrl?: boolean; meta?: boolean; alt?: boolean; altGr?: boolean } = {}) => ({
  key,
  ctrlKey: !!held.ctrl,
  metaKey: !!held.meta,
  altKey: !!held.alt,
  getModifierState: (name: string) => name === 'AltGraph' && !!held.altGr,
})

describe('typesText', () => {
  it('takes anything that types a character', () => {
    for (const k of ['a', 'Z', '7', '.', '/', 'é', 'ß', '你', '🙂']) {
      expect(typesText(key(k), true), k).toBe(true)
      expect(typesText(key(k), false), k).toBe(true)
    }
  })

  it('takes the first stroke of an accent or an input method', () => {
    expect(typesText(key('Dead'), true)).toBe(true)
    expect(typesText(key('Process'), false)).toBe(true)
  })

  it('leaves keys that type nothing, and the space bar', () => {
    for (const k of [' ', 'Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'PageDown', 'F5', 'Shift', 'Meta', 'CapsLock'])
      expect(typesText(key(k), true), k).toBe(false)
  })

  it('leaves shortcuts', () => {
    expect(typesText(key('c', { meta: true }), true)).toBe(false)
    expect(typesText(key('k', { meta: true }), true)).toBe(false)
    expect(typesText(key('a', { ctrl: true }), true)).toBe(false)
    expect(typesText(key('r', { ctrl: true }), false)).toBe(false)
    expect(typesText(key('f', { alt: true }), false)).toBe(false)
    expect(typesText(key('a', { meta: true }), false)).toBe(false)
  })

  it('takes a paste, by the platform’s own key', () => {
    expect(typesText(key('v', { meta: true }), true)).toBe(true)
    expect(typesText(key('V', { meta: true }), true)).toBe(true)
    expect(typesText(key('v', { ctrl: true }), false)).toBe(true)
    expect(typesText(key('v', { ctrl: true }), true)).toBe(false)
    expect(typesText(key('v', { meta: true }), false)).toBe(false)
    expect(typesText(key('v', { meta: true, alt: true }), true)).toBe(false)
  })

  it('takes what ⌥ types on a Mac, and AltGr elsewhere', () => {
    expect(typesText(key('@', { alt: true }), true)).toBe(true)
    expect(typesText(key('Dead', { alt: true }), true)).toBe(true)
    // Windows reports AltGr as Ctrl+Alt.
    expect(typesText(key('@', { ctrl: true, alt: true, altGr: true }), false)).toBe(true)
    expect(typesText(key('q', { ctrl: true, alt: true }), false)).toBe(false)
  })
})
