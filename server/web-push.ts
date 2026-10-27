// Web Push with Node's own crypto: no dependencies, like the rest of the
// server. A browser that turns notifications on hands Murmur a subscription
// (an address at its maker's push service, and two keys of its own). Each
// note is encrypted for that browser alone (RFC 8291, aes128gcm) and the
// request is signed with Murmur's key pair (VAPID, RFC 8292), so the push
// service knows who's sending and only ever carries ciphertext.

import { createCipheriv, createECDH, createHash, createPrivateKey, createSign, ECDH, hkdfSync, randomBytes, type KeyObject } from 'node:crypto'

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } }

/** Murmur's key pair, base64url: the public key as the raw point browsers take, the private scalar. */
export type VapidKeys = { publicKey: string; privateKey: string }

export type PushOptions = {
  /** How long the push service keeps trying a device that's away, in seconds. */
  ttl: number
  /** `high` wakes a sleeping phone at once; `normal` may wait for a better moment. */
  urgency: 'high' | 'normal'
  /** A newer push with the same topic replaces one still waiting to be delivered. */
  topic?: string
}

/** What the push service said: delivered, gone for good (forget the device), or failed this time. */
export type PushResult = { status: number; gone: boolean }

/** Who's sending, for push services to reach if something's wrong. */
const SUBJECT = 'https://umbrel.com/murmur'
const RECORD_SIZE = 4096

const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64url')
const unb64 = (text: string) => Buffer.from(text, 'base64url')

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()) }
}

/** Keys that are a P-256 pair (a hand-edited or truncated file isn't). */
export function validVapidKeys(keys: unknown): keys is VapidKeys {
  const k = keys as Partial<VapidKeys> | null
  if (typeof k?.publicKey !== 'string' || typeof k.privateKey !== 'string') return false
  try {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(unb64(k.privateKey))
    return ecdh.getPublicKey().equals(unb64(k.publicKey))
  } catch {
    return false
  }
}

/** A browser's push key: a point on P-256, which a made-up one isn't. */
export function validPushKey(key: string) {
  try {
    ECDH.convertKey(unb64(key), 'prime256v1')
    return true
  } catch {
    return false
  }
}

const signingKeys = new Map<string, KeyObject>()

function signingKey({ publicKey, privateKey }: VapidKeys) {
  let key = signingKeys.get(privateKey)
  if (!key) {
    const point = unb64(publicKey)
    const jwk = { kty: 'EC', crv: 'P-256', d: privateKey, x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) }
    signingKeys.set(privateKey, (key = createPrivateKey({ key: jwk, format: 'jwk' })))
  }
  return key
}

/** The Authorization header for one push service: a signed token, good for 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()) {
  const segment = (value: object) => b64(Buffer.from(JSON.stringify(value)))
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: SUBJECT }
  const unsigned = `${segment({ typ: 'JWT', alg: 'ES256' })}.${segment(claims)}`
  // JWTs take the signature as r‖s, not DER.
  const signature = createSign('SHA256').update(unsigned).sign({ key: signingKey(keys), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${unsigned}.${b64(signature)}, k=${keys.publicKey}`
}

/**
 * The body of one push: `payload` encrypted for one browser (RFC 8291). The
 * salt and Murmur's one-time key pair are fresh each time; tests pass them in.
 */
export function encrypt(subscription: Subscription, payload: Buffer, fixed?: { salt: Buffer; privateKey: Buffer }) {
  const receiver = unb64(subscription.keys.p256dh)
  const auth = unb64(subscription.keys.auth)
  const salt = fixed?.salt ?? randomBytes(16)
  const ecdh = createECDH('prime256v1')
  if (fixed) ecdh.setPrivateKey(fixed.privateKey)
  else ecdh.generateKeys()
  const sender = ecdh.getPublicKey()
  const secret = ecdh.computeSecret(receiver)

  const hkdf = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length))
  const ikm = hkdf(secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), receiver, sender]), 32)
  const key = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)

  // One record: the payload, then the delimiter that says it's the last.
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  const sealed = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(sender.length, 20)
  return Buffer.concat([header, sender, sealed])
}

/** A Topic header (at most 32 URL-safe characters) for any string. */
export const topicFor = (text: string) => createHash('sha256').update(text).digest('base64url').slice(0, 32)

/** Sends one push. Never throws: a device that can't be reached is a result, not an error. */
export async function sendPush(subscription: Subscription, payload: string, keys: VapidKeys, options: PushOptions): Promise<PushResult> {
  try {
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidAuthorization(subscription.endpoint, keys),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(options.ttl),
        urgency: options.urgency,
        ...(options.topic && { topic: options.topic }),
      },
      body: encrypt(subscription, Buffer.from(payload)),
      signal: AbortSignal.timeout(15_000),
    })
    await res.body?.cancel().catch(() => {})
    // 404 and 410: the browser unsubscribed, or the subscription expired.
    return { status: res.status, gone: res.status === 404 || res.status === 410 }
  } catch {
    return { status: 0, gone: false }
  }
}
