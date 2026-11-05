import { describe, expect, it } from 'vitest'
import { readShare } from './share'

const share = (params: Record<string, string>) => readShare(new URLSearchParams(params))

describe('something shared into Murmur', () => {
  it('is a page’s title over its link, the way Chrome on Android shares one', () => {
    expect(share({ title: 'Bread, the slow way', text: 'https://example.com/bread' })).toEqual({
      text: 'Bread, the slow way\nhttps://example.com/bread',
      url: 'https://example.com/bread',
      title: 'Bread, the slow way',
    })
  })

  it('has its link once, wherever the app put it', () => {
    expect(share({ text: 'Look at this https://example.com/a', url: 'https://example.com/a' })?.text).toBe(
      'Look at this https://example.com/a',
    )
    expect(share({ text: 'Look at this', url: 'https://example.com/a' })?.text).toBe('Look at this\nhttps://example.com/a')
    expect(share({ url: 'https://example.com/a' })).toEqual({ text: 'https://example.com/a', url: 'https://example.com/a' })
  })

  it('leaves out a title the text already says, or one that is just the link', () => {
    expect(share({ title: 'Bread', text: 'Bread https://example.com/bread' })?.text).toBe('Bread https://example.com/bread')
    expect(share({ title: 'https://example.com/a', text: 'https://example.com/a' })).toEqual({
      text: 'https://example.com/a',
      url: 'https://example.com/a',
    })
  })

  it('keeps words with no link as they are, a note’s title over it', () => {
    expect(share({ title: 'Groceries', text: 'Eggs\r\nFlour\r\nButter' })).toEqual({
      text: 'Groceries\nEggs\nFlour\nButter',
      url: undefined,
      title: 'Groceries',
    })
    expect(share({ text: '  “The best way out is always through.”  ' })?.text).toBe('“The best way out is always through.”')
  })

  it('finds the link inside the words, without the punctuation after it', () => {
    expect(share({ text: 'Read this (https://example.com/a/b?c=1).' })?.url).toBe('https://example.com/a/b?c=1')
  })

  it('is nothing when nothing came', () => {
    expect(share({})).toBeNull()
    expect(share({ title: ' ', text: '\n' })).toBeNull()
  })
})
