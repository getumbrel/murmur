import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(), gateway: { on: () => () => {} } }))
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: Error }))

const {
  codeGroups,
  codeState,
  codeValue,
  fieldFor,
  guessServers,
  mailIcon,
  serverOf,
  withSecurity,
} = await import('./email-form')

describe('app passwords', () => {
  it('reads Google’s sixteen letters however they were pasted', () => {
    expect(codeGroups('tkqm vbpe hwnz abcd')).toEqual(['tkqm', 'vbpe', 'hwnz', 'abcd'])
    expect(codeGroups('tkqmvb')).toEqual(['tkqm', 'vb', '', ''])
    expect(codeState('gmail', 'tkqm vbpe hwnz abcd')).toBe('ready')
    expect(codeState('gmail', ' tkqm vbpe hwnz\nabcd ')).toBe('ready')
    expect(codeState('gmail', 'tkqm vbpe hwnz')).toBe('typing')
    expect(codeState('gmail', '')).toBe('empty')
  })

  it('says when it isn’t one: digits, symbols or too long for Google', () => {
    expect(codeState('gmail', 'hunter2hunter2!!')).toBe('wrong')
    expect(codeState('gmail', 'tkqm vbpe hwnz abcd e')).toBe('wrong')
  })

  it('sends Apple’s with its dashes, as Apple shows it', () => {
    expect(codeValue('icloud', 'abcd efgh ijkl mnop')).toBe('abcd-efgh-ijkl-mnop')
    expect(codeValue('icloud', 'abcd-efgh-ijkl-mnop')).toBe('abcd-efgh-ijkl-mnop')
    expect(codeState('icloud', 'abcd-efgh-ijkl-mnop')).toBe('ready')
  })

  it('sends the others without spaces', () => {
    expect(codeValue('gmail', 'tkqm vbpe hwnz abcd')).toBe('tkqmvbpehwnzabcd')
    expect(codeValue('fastmail', '4n5x 8hmz 3d6s 9ef7')).toBe('4n5x8hmz3d6s9ef7')
  })

  it('lets Fastmail’s letters and numbers through, and doesn’t insist on a length it can’t be sure of', () => {
    expect(codeState('fastmail', '4n5x 8hmz 3d6s 9ef7')).toBe('ready')
    expect(codeState('fastmail', '4n5x 8hmz')).toBe('ready')
    expect(codeState('yahoo', 'abc1')).toBe('wrong')
  })
})

describe('a failed sign-in points at the field to fix', () => {
  const filled = { address: true, password: true }
  it('the password, when it was turned down', () => {
    expect(fieldFor('gmail', 'wrong_password', 'incoming', filled)).toBe('password')
    expect(fieldFor('icloud', 'app_password', null, filled)).toBe('password')
  })

  it('another account’s outgoing server, when only sending turned it down', () => {
    expect(fieldFor('other', 'wrong_password', 'outgoing', filled)).toBe('outgoing')
  })

  it('another account’s server that couldn’t be reached; nothing for a provider’s', () => {
    expect(fieldFor('other', 'unreachable', 'incoming', filled)).toBe('incoming')
    expect(fieldFor('other', 'tls', 'outgoing', filled)).toBe('outgoing')
    expect(fieldFor('gmail', 'unreachable', 'incoming', filled)).toBeNull()
  })

  it('whatever was left empty', () => {
    expect(fieldFor('gmail', 'incomplete', null, { address: false, password: true })).toBe('address')
    expect(fieldFor('gmail', 'incomplete', null, { address: true, password: false })).toBe('password')
  })

  it('nothing the person typed, for the rest', () => {
    expect(fieldFor('gmail', 'unknown', null, filled)).toBeNull()
    expect(fieldFor('other', 'save', null, filled)).toBeNull()
  })
})

describe('another account’s servers', () => {
  it('are guessed from the address', () => {
    expect(guessServers('ada@Work.Example.com')).toEqual({
      incoming: { host: 'imap.work.example.com', port: '993', security: 'ssl' },
      outgoing: { host: 'smtp.work.example.com', port: '465', security: 'ssl' },
    })
    expect(guessServers('ada').incoming.host).toBe('')
  })

  it('move to the usual port when their security changes, unless the person chose one', () => {
    const incoming = { host: 'imap.example.com', port: '993', security: 'ssl' as const }
    expect(withSecurity('incoming', incoming, 'starttls').port).toBe('143')
    expect(withSecurity('outgoing', { ...incoming, port: '465' }, 'starttls').port).toBe('587')
    expect(withSecurity('incoming', { ...incoming, port: '1993' }, 'none').port).toBe('1993')
  })

  it('are only complete with a name and a real port', () => {
    expect(serverOf({ host: ' mail ', port: '3143', security: 'none' })).toEqual({ host: 'mail', port: 3143, security: 'none' })
    expect(serverOf({ host: 'mail', port: '99999', security: 'none' })).toBeNull()
    expect(serverOf({ host: '', port: '993', security: 'ssl' })).toBeNull()
  })
})

it('draws an account as its provider, or the plain envelope', () => {
  expect(mailIcon('gmail')).toBe('gmail')
  expect(mailIcon('other')).toBe('email')
})
