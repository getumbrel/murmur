import { describe, expect, it } from 'vitest'
import { hang, isDrawn, lines } from './code-lines'

describe('isDrawn', () => {
  it('leaves ordinary code, commands and logs to fold', () => {
    expect(isDrawn('docker run -d --name app -p 8080:80 -v /data:/data image:latest')).toBe(false)
    expect(isDrawn('{\n  "a": 1\n}')).toBe(false)
    expect(isDrawn('a | b || c\n--flag')).toBe(false)
    expect(isDrawn('2026-11-12 10:00:01  INFO  started')).toBe(false)
  })
  it('keeps the shape of boxed tables, trees and diagrams', () => {
    expect(isDrawn('+----+-----+\n| id | name |\n+----+-----+')).toBe(true)
    expect(isDrawn('| id | name |\n|----|------|\n| 1 | a |')).toBe(true)
    expect(isDrawn('src\n├── a.ts\n└── b.ts')).toBe(true)
    expect(isDrawn('┌───┐\n│ a │\n└───┘')).toBe(true)
  })
})

describe('hang', () => {
  it('sits just inside the line’s own indentation', () => {
    expect(hang('ls')).toBe(2)
    expect(hang('    let x = 1')).toBe(6)
    expect(hang('\t\tx')).toBe(6)
  })
  it('stops deepening so narrow screens keep room to read', () => {
    expect(hang(' '.repeat(40) + 'x')).toBe(14)
  })
})

describe('lines', () => {
  const t = (content: string) => ({ content })
  it('is plain before any highlighting arrives', () => {
    expect(lines('a\n\nb')).toEqual([
      { tokens: [], rest: 'a', hang: 2 },
      { tokens: [], rest: '', hang: 2 },
      { tokens: [], rest: 'b', hang: 2 },
    ])
  })
  it('shows what is highlighted and the plain remainder of a line still arriving', () => {
    const out = lines('let x = 1\n  foo(bar)', [[t('let'), t(' x = 1')], [t('  foo')]])
    expect(out[0]).toEqual({ tokens: [t('let'), t(' x = 1')], rest: '', hang: 2 })
    expect(out[1]).toEqual({ tokens: [t('  foo')], rest: '(bar)', hang: 4 })
  })
  it('falls back to plain text if highlighting does not match the line', () => {
    expect(lines('abc', [[t('xyz')]])[0]).toEqual({ tokens: [], rest: 'abc', hang: 2 })
  })
})
