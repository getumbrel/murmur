import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))

const { fileRef, parseUserMessage } = await import('./parse')

describe('fileRef', () => {
  it('leaves a plain path bare, and quotes one Hermes would misread', () => {
    expect(fileRef('attachments/notes.txt')).toBe('@file:attachments/notes.txt')
    expect(fileRef('attachments/my notes.txt')).toBe('@file:`attachments/my notes.txt`')
    expect(fileRef('attachments/it`s (1).txt')).toBe('@file:"attachments/it`s (1).txt"')
  })

  it('reads back as the same file, the way history reads a message', () => {
    for (const path of ['attachments/notes.txt', 'attachments/my notes.txt', 'attachments/it`s "best" (1).txt']) {
      expect(parseUserMessage(`${fileRef(path)}\n\nHave a look`)).toEqual({
        text: 'Have a look',
        attachments: [{ kind: 'file', name: path.split('/').pop(), path }],
      })
    }
  })
})
