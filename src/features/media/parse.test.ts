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
