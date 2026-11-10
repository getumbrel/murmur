import { describe, expect, it } from 'vitest'
import { fileName } from './transcript'

describe("a chat's file name", () => {
  it('is what the chat is called', () => {
    expect(fileName('Lisbon in May')).toBe('Lisbon in May.md')
  })

  it('leaves out what a file name cannot hold', () => {
    expect(fileName('Rent: split 50/50? "Yes"')).toBe('Rent split 50 50 Yes.md')
    expect(fileName('..hidden.')).toBe('hidden.md')
    expect(fileName('a\tb\nc')).toBe('a b c.md')
  })

  it('is cut at a word when it runs long', () => {
    const name = fileName('word '.repeat(40))
    expect(name.length).toBeLessThanOrEqual(83)
    expect(name).toMatch(/word\.md$/)
  })

  it('still has a name when the title leaves nothing', () => {
    expect(fileName('???')).toBe('Chat.md')
  })
})
