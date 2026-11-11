import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))

const { fileRef, parseUserMessage, picturesIn } = await import('./parse')

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

describe('a message Hermes saved in parts', () => {
  const DUNES = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwME'
  const LAKE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
  const part = (url: string) => ({ type: 'image_url', image_url: { url } })
  // A photo sent from Hermes Desktop on the turn Hermes summarized the chat (0.23.0), as history returns it.
  const row = [
    { type: 'text', text: 'Where do you think this is?\n\n[Image attached at: /opt/data/images/upload_gq2qyo8l.jpg]' },
    part(DUNES),
  ]
  const read = (content: unknown[]) =>
    parseUserMessage(content.map((p) => (p as { text?: string }).text ?? '').join(''), picturesIn(content))

  it('shows the photo from the message itself, under the name of its file', () => {
    const pictures = picturesIn(row)
    expect(pictures).toEqual([DUNES])
    // The picture itself, megabytes of it: handed on, not copied.
    expect(read(row).attachments[0]).toHaveProperty('url', pictures[0])
    expect(read(row)).toEqual({
      text: 'Where do you think this is?',
      attachments: [{ kind: 'image', name: 'upload_gq2qyo8l.jpg', path: '/opt/data/images/upload_gq2qyo8l.jpg', url: DUNES }],
    })
  })

  it('pairs each photo with the file it came from, in order, a repeat included', () => {
    const hints = ['/i/a.jpg', '/i/b.png', '/i/a.jpg'].map((path) => `[Image attached at: ${path}]`).join('\n')
    expect(read([{ type: 'text', text: `Which one?\n\n${hints}` }, part(DUNES), part(LAKE), part(DUNES)])).toEqual({
      text: 'Which one?',
      attachments: [
        { kind: 'image', name: 'a.jpg', path: '/i/a.jpg', url: DUNES },
        { kind: 'image', name: 'b.png', path: '/i/b.png', url: LAKE },
      ],
    })
    // The way Hermes Desktop's own messages name them.
    expect(read([{ type: 'text', text: 'Which one?\n@image:/i/a.jpg\n@image:/i/b.png' }, part(DUNES), part(LAKE)])).toEqual({
      text: 'Which one?',
      attachments: [
        { kind: 'image', name: 'a.jpg', path: '/i/a.jpg', url: DUNES },
        { kind: 'image', name: 'b.png', path: '/i/b.png', url: LAKE },
      ],
    })
  })

  it('shows photos its words don’t name, and ones on the web', () => {
    expect(read([{ type: 'text', text: 'And these?' }, part(DUNES), { type: 'input_image', image_url: LAKE }])).toEqual({
      text: 'And these?',
      attachments: [
        { kind: 'image', name: 'image.jpg', url: DUNES },
        { kind: 'image', name: 'image.png', url: LAKE },
      ],
    })
    const web = 'https://example.com/photos/the%20lake.webp?size=large'
    expect(read([{ type: 'text', text: `Look\n\n[Image attached: ${web}]` }, part(web)])).toEqual({
      text: 'Look',
      attachments: [{ kind: 'image', name: 'the lake.webp', url: web }],
    })
  })

  it('finds no pictures in words alone, or in parts that aren’t pictures', () => {
    expect(picturesIn('data:image/png;base64,AAAA')).toEqual([])
    expect(picturesIn(null)).toEqual([])
    expect(picturesIn(part(LAKE))).toEqual([LAKE])
    expect(picturesIn([null, 'words', { type: 'text', text: 'hi' }, { type: 'image_url' }, part('javascript:alert(1)'), { type: 'input_audio' }])).toEqual([])
  })

  it('still shows a photo by its file when the message was saved as words', () => {
    expect(parseUserMessage('Which one?\n@image:/i/a.jpg\n[screenshot]')).toEqual({
      text: 'Which one?',
      attachments: [{ kind: 'image', name: 'a.jpg', path: '/i/a.jpg' }],
    })
  })
})

const { splitQuote, tidyQuote, withQuote } = await import('./parse')

describe('replying to a part of a reply', () => {
  it('sends the passage as a blockquote, a blank line, then your words', () => {
    expect(withQuote('The 28 tram is the scenic one.', 'Is it crowded?')).toBe('> The 28 tram is the scenic one.\n\nIs it crowded?')
  })

  it('quotes every line of a passage, blank ones too', () => {
    expect(withQuote('Day one\n\nDay two', 'Swap these')).toBe('> Day one\n>\n> Day two\n\nSwap these')
  })

  it('sends a passage with nothing under it, and words with no passage as they are', () => {
    expect(withQuote('Just this', '')).toBe('> Just this')
    expect(withQuote(undefined, 'Hello')).toBe('Hello')
    expect(withQuote('  \n ', 'Hello')).toBe('Hello')
  })

  it('tidies what was selected: line ends, runs of blank lines, the ends', () => {
    expect(tidyQuote('\n  One  \r\n\r\n\r\n\r\nTwo\t\n')).toBe('One\n\nTwo')
  })

  it('reads the passage back out of a message', () => {
    expect(splitQuote('> The 28 tram is the scenic one.\n\nIs it crowded?')).toEqual({
      quote: 'The 28 tram is the scenic one.',
      text: 'Is it crowded?',
    })
    expect(splitQuote('> Day one\n>\n> Day two\n\nSwap these\n\nPlease')).toEqual({
      quote: 'Day one\n\nDay two',
      text: 'Swap these\n\nPlease',
    })
  })

  it('reads a message that is only a passage', () => {
    expect(splitQuote('> Just this')).toEqual({ quote: 'Just this', text: '' })
  })

  it('round-trips whatever was quoted', () => {
    for (const [quote, text] of [
      ['One line', 'Words'],
      ['Two\nlines', 'Words\n\nover two paragraphs'],
      ['> already quoted\nand more', 'Why?'],
      ['const a = 1\n\n  indented()', ''],
    ]) {
      expect(splitQuote(withQuote(quote, text))).toEqual({ quote, text })
    }
  })

  it('leaves a message alone when it doesn’t open with a passage', () => {
    expect(splitQuote('Hello\n\n> not at the top')).toEqual({ text: 'Hello\n\n> not at the top' })
    // More typed straight under it: that's the person's own ">".
    expect(splitQuote('> 5 is what I meant\nand < 9')).toEqual({ text: '> 5 is what I meant\nand < 9' })
    expect(splitQuote('>no space')).toEqual({ text: '>no space' })
    expect(splitQuote('>\n\nHello')).toEqual({ text: '>\n\nHello' })
    expect(splitQuote('')).toEqual({ text: '' })
  })

  it('reads the passage from a message as Hermes stored it, files and all', () => {
    const stored = `> The 28 tram\n\nIs it crowded?\n\n${fileRef('attachments/map.pdf')}`
    const { text, attachments } = parseUserMessage(stored)
    expect(attachments).toEqual([{ kind: 'file', name: 'map.pdf', path: 'attachments/map.pdf' }])
    expect(splitQuote(text)).toEqual({ quote: 'The 28 tram', text: 'Is it crowded?' })
  })
})
