import { createDecipheriv, createECDH, createPublicKey, createVerify, hkdfSync, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encrypt, generateVapidKeys, topicFor, validVapidKeys, vapidAuthorization, type Subscription } from './web-push.ts'

const b = (text: string) => Buffer.from(text, 'base64url')

describe('encrypt', () => {
  it('matches RFC 8291’s worked example, byte for byte', () => {
    const subscription: Subscription = {
      endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
      keys: {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
    }
    const body = encrypt(subscription, Buffer.from('When I grow up, I want to be a watermelon'), {
      salt: b('DGv6ra1nlYgDCS1FRnbzlw'),
      privateKey: b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
    })
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('is read back by the browser it was for', () => {
    // The browser's side: its key pair and auth secret.
    const browser = createECDH('prime256v1')
    browser.generateKeys()
    const auth = randomBytes(16)
    const subscription = { endpoint: 'https://push.example/x', keys: { p256dh: browser.getPublicKey('base64url'), auth: auth.toString('base64url') } }
    const note = JSON.stringify({ web_push: 8030, notification: { title: 'Atlas', body: 'Done ✓' } })
    const body = encrypt(subscription, Buffer.from(note))

    const salt = body.subarray(0, 16)
    const sender = body.subarray(21, 21 + body.readUInt8(20))
    const secret = browser.computeSecret(sender)
    const hkdf = (ikm: Buffer, salt: Buffer, info: string | Buffer, n: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, n))
    const ikm = hkdf(secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), sender]), 32)
    const sealed = body.subarray(21 + sender.length)
    const decipher = createDecipheriv('aes-128-gcm', hkdf(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hkdf(ikm, salt, 'Content-Encoding: nonce\0', 12))
    decipher.setAuthTag(sealed.subarray(-16))
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()])
    expect(plain.at(-1)).toBe(2)
    expect(plain.subarray(0, -1).toString()).toBe(note)
  })
})

describe('VAPID', () => {
  it('signs a token for the push service’s origin that its public key verifies', () => {
    const keys = generateVapidKeys()
    expect(validVapidKeys(keys)).toBe(true)
    const now = Date.UTC(2026, 9, 26)
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', keys, now)
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(k).toBe(keys.publicKey)
    const [head, claims, signature] = token.split('.')
    expect(JSON.parse(b(head).toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(b(claims).toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://umbrel.com/murmur' })
    expect(b(signature)).toHaveLength(64)
    const point = b(keys.publicKey)
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' })
    expect(createVerify('SHA256').update(`${head}.${claims}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, b(signature))).toBe(true)
  })

  it('turns away keys that aren’t a pair', () => {
    const [one, two] = [generateVapidKeys(), generateVapidKeys()]
    expect(validVapidKeys({ publicKey: one.publicKey, privateKey: two.privateKey })).toBe(false)
    expect(validVapidKeys({ publicKey: 'x', privateKey: 'y' })).toBe(false)
    expect(validVapidKeys(null)).toBe(false)
  })
})

describe('topicFor', () => {
  it('is short, URL-safe and the same for the same chat', () => {
    const topic = topicFor('murmur:chat:20261014_101500_abc')
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(topicFor('murmur:chat:20261014_101500_abc')).toBe(topic)
    expect(topicFor('murmur:chat:other')).not.toBe(topic)
  })
})
