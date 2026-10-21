import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn() }))

const {
  cardBrand,
  cardFromLabel,
  cardLabel,
  formatCardNumber,
  formatExpiry,
  hostOf,
  identifierType,
  luhn,
  originOf,
  parseExpiry,
  toEntries,
  toWire,
  vaultActions,
} = await import('./vault')
const { rpc } = (await import('@/hermes/gateway')) as unknown as { rpc: ReturnType<typeof vi.fn> }

describe('a site', () => {
  it('becomes the origin Hermes fills on', () => {
    expect(originOf('github.com')).toBe('https://github.com')
    expect(originOf('  GitHub.com/login  ')).toBe('https://github.com')
    expect(originOf('https://www.amazon.com/ap/signin?openid=x')).toBe('https://www.amazon.com')
    expect(originOf('http://shop.example.com:8080/cart')).toBe('http://shop.example.com:8080')
    expect(originOf('https://example.com:443')).toBe('https://example.com')
  })

  it('on this network is plain http unless it says otherwise', () => {
    expect(originOf('localhost:8765')).toBe('http://localhost:8765')
    expect(originOf('umbrel.local')).toBe('http://umbrel.local')
    expect(originOf('192.168.1.20:3000')).toBe('http://192.168.1.20:3000')
    expect(originOf('https://umbrel.local')).toBe('https://umbrel.local')
  })

  it('isn’t one until it looks like an address', () => {
    for (const s of ['', 'github', 'git hub.com', 'ftp://files.example.com', 'mailto:me@example.com', 'https://'])
      expect(originOf(s)).toBeUndefined()
  })

  it('is shown by its host', () => {
    expect(hostOf('https://www.amazon.com')).toBe('www.amazon.com')
    expect(hostOf('http://localhost:8765')).toBe('localhost:8765')
  })
})

describe('a login', () => {
  it('signs in with an email, a phone or a username, as Hermes tells them apart', () => {
    expect(identifierType('me@example.com')).toBe('email')
    expect(identifierType('+44 7700 900123')).toBe('phone')
    expect(identifierType('5551234567')).toBe('phone')
    expect(identifierType('octocat')).toBe('username')
    expect(identifierType('agent007')).toBe('username')
  })

  it('is sent with its host as its name and only the password secret', () => {
    expect(
      toWire({ kind: 'login', site: 'github.com/login', identifier: ' me@example.com ', password: 'p a s s', otp: ' ' }),
    ).toEqual({
      kind: 'login',
      label: 'github.com',
      origin: 'https://github.com',
      secret: { identifier_type: 'email', identifier: 'me@example.com', password: 'p a s s' },
    })
    expect(toWire({ kind: 'login', site: 'github.com', identifier: 'me', password: 'x', otp: 'JBSW Y3DP' })?.secret).toMatchObject({
      otp_secret: 'JBSW Y3DP',
    })
  })

  it('isn’t sent without a site, a name to sign in with and a password', () => {
    expect(toWire({ kind: 'login', site: 'github', identifier: 'me', password: 'x' })).toBeUndefined()
    expect(toWire({ kind: 'login', site: 'github.com', identifier: ' ', password: 'x' })).toBeUndefined()
    expect(toWire({ kind: 'login', site: 'github.com', identifier: 'me', password: '' })).toBeUndefined()
  })
})

describe('a card', () => {
  it('knows its brand from the first digits', () => {
    expect(cardBrand('4242 4242')).toBe('visa')
    expect(cardBrand('5555')).toBe('mastercard')
    expect(cardBrand('2221 00')).toBe('mastercard')
    expect(cardBrand('3782')).toBe('amex')
    expect(cardBrand('6011')).toBe('discover')
    expect(cardBrand('3056')).toBe('diners')
    expect(cardBrand('3530')).toBe('jcb')
    expect(cardBrand('9999')).toBeUndefined()
  })

  it('reads in groups, Amex its own way', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('42424')).toBe('4242 4')
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005')
    expect(formatCardNumber('4242-4242 42x')).toBe('4242 4242 42')
  })

  it('passes the Luhn check, or isn’t a card', () => {
    expect(luhn('4242424242424242')).toBe(true)
    expect(luhn('4242424242424241')).toBe(false)
  })

  it('takes its expiry as it’s typed', () => {
    expect(formatExpiry('1')).toBe('1')
    expect(formatExpiry('4')).toBe('04 / ')
    expect(formatExpiry('12')).toBe('12 / ')
    expect(formatExpiry('12 / 3')).toBe('12 / 3')
    expect(formatExpiry('12303')).toBe('12 / 30')
    // Deleting back over the slash.
    expect(formatExpiry('12 /', '12 / ')).toBe('1')
  })

  it('expires at the end of its month', () => {
    const now = new Date(2026, 9, 21)
    expect(parseExpiry('10 / 26', now)).toEqual({ month: '10', year: '2026' })
    expect(parseExpiry('1/2030', now)).toEqual({ month: '01', year: '2030' })
    expect(parseExpiry('0926', now)).toBeUndefined()
    expect(parseExpiry('0930', now)).toEqual({ month: '09', year: '2030' })
    expect(parseExpiry('13 / 30', now)).toBeUndefined()
    expect(parseExpiry('12 / 3', now)).toBeUndefined()
  })

  it('is named by its brand and last four, which can be read back', () => {
    expect(cardLabel('4242 4242 4242 4242')).toBe('Visa •••• 4242')
    expect(cardLabel('6200000000000005')).toBe('UnionPay •••• 0005')
    expect(cardLabel('9999999999999995')).toBe('Card •••• 9995')
    expect(cardFromLabel('Visa •••• 4242')).toEqual({ brand: 'visa', last4: '4242' })
    expect(cardFromLabel('Amex •••• 0005')).toEqual({ brand: 'amex', last4: '0005' })
    expect(cardFromLabel('Work card')).toEqual({ brand: undefined, last4: undefined })
  })

  it('is sent whole, with a four-digit year', () => {
    const wire = toWire({ kind: 'payment', site: 'www.amazon.com', number: '4242 4242 4242 4242', expiry: '12 / 30', cvc: '123', name: ' Ada ', postcode: '' })
    expect(wire).toEqual({
      kind: 'payment',
      label: 'Visa •••• 4242',
      origin: 'https://www.amazon.com',
      secret: { card_number: '4242424242424242', exp_month: '12', exp_year: '2030', cvc: '123', cardholder_name: 'Ada' },
    })
  })

  it('isn’t sent with a number that fails, a passed expiry or the wrong length of code', () => {
    const card = { kind: 'payment', site: 'amazon.com', number: '4242424242424242', expiry: '12 / 30', cvc: '123' } as const
    expect(toWire({ ...card, number: '4242424242424241' })).toBeUndefined()
    expect(toWire({ ...card, expiry: '01 / 20' })).toBeUndefined()
    expect(toWire({ ...card, cvc: '12' })).toBeUndefined()
    // Amex has four.
    expect(toWire({ ...card, number: '378282246310005', cvc: '123' })).toBeUndefined()
    expect(toWire({ ...card, number: '378282246310005', cvc: '1234' })).toBeDefined()
  })
})

describe('an address', () => {
  it('is named by its first line and sent without empty parts', () => {
    expect(
      toWire({ kind: 'address', site: 'amazon.com', line1: ' 1 Main St ', line2: '', city: 'Springfield', state: ' ', postcode: '12345', country: 'US' }),
    ).toEqual({
      kind: 'address',
      label: '1 Main St',
      origin: 'https://amazon.com',
      secret: { address_line1: '1 Main St', city: 'Springfield', postal_code: '12345', country: 'US' },
    })
  })
})

describe('the list', () => {
  it('is Hermes’s own vault only, by name', () => {
    const entries = toEntries([
      { id: 'b', kind: 'login', label: 'zeta.com', origin: 'https://zeta.com', identifier: 'z', has_otp: true, backend: 'local', created_at: '2026-10-20T10:00:00+00:00' },
      { id: 'a', kind: 'payment', label: 'Visa •••• 4242', origin: 'https://shop.com', backend: 'local' },
      { id: 'op', kind: 'login', label: 'From 1Password', backend: 'onepassword' },
      { id: 'n', kind: 'note', label: 'Unknown kind', backend: 'local' },
    ])
    expect(entries.map((e) => e.id)).toEqual(['a', 'b'])
    expect(entries[1]).toMatchObject({ kind: 'login', origin: 'https://zeta.com', identifier: 'z', otp: true })
    expect(entries[1].added?.toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })
})

describe('changing an item', () => {
  const qc = () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: vi.fn() })
  const old = { id: 'old', kind: 'login', label: 'github.com', otp: false } as const
  const input = { kind: 'login', site: 'github.com', identifier: 'me', password: 'new' } as const

  it('adds the new one before the old one goes', async () => {
    const calls: string[] = []
    rpc.mockReset().mockImplementation(async (method: string) => {
      calls.push(method)
      return method === 'vault.add' ? { id: 'new' } : { removed: true }
    })
    await expect(vaultActions(qc() as never, 'default').replace(old, input)).resolves.toBe('new')
    expect(calls).toEqual(['vault.add', 'vault.remove'])
  })

  it('keeps the old one when the new one can’t be saved', async () => {
    rpc.mockReset().mockRejectedValue(Object.assign(new Error('bad'), { code: 5095 }))
    await expect(vaultActions(qc() as never, 'default').replace(old, input)).rejects.toThrow('Hermes couldn’t save that')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('says when Hermes is too old for passwords', async () => {
    rpc.mockReset().mockRejectedValue(Object.assign(new Error('unknown method'), { code: -32601 }))
    await expect(vaultActions(qc() as never, 'default').add(input)).rejects.toThrow('This Hermes can’t keep passwords yet')
  })
})
