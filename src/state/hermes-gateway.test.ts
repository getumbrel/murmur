import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class HermesError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
vi.mock('@/hermes/rest', () => ({ api: { get: vi.fn(), post: vi.fn() }, HermesError }))
vi.mock('@/state/telegram', () => ({ telegramKey: (id: string) => ['telegram', id] }))
vi.mock('@/state/whatsapp', () => ({ whatsappKey: (id: string) => ['whatsapp', id] }))

const { startGateway } = await import('./hermes-gateway')
const { api } = await import('@/hermes/rest')
const get = vi.mocked(api.get)
const post = vi.mocked(api.post)

/** A Hermes whose gateway comes up `upAfter` ms after it's asked, or whose own start ends with `exit`. */
function hermes({ upAfter, exit = 0 }: { upAfter?: number; exit?: number }) {
  let asked = -1
  post.mockImplementation(async () => {
    asked = Date.now()
    return { ok: true }
  })
  get.mockImplementation(async (path: string) => {
    const up = upAfter !== undefined && asked >= 0 && Date.now() - asked >= upAfter
    // Hermes's start action: still going while the gateway comes up, over at once when it can't.
    if (path.startsWith('/api/actions/')) return upAfter === undefined && asked >= 0 ? { running: false, exit_code: exit } : { running: true }
    return { gateway_running: up }
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('turning on an agent’s gateway', () => {
  it('asks for that agent’s, and waits until it’s up', async () => {
    hermes({ upAfter: 3000 })
    const starting = startGateway('atlas')
    await vi.advanceTimersByTimeAsync(5000)
    expect(await starting).toMatchObject({ gateway_running: true })
    expect(post).toHaveBeenCalledWith('/api/gateway/start?profile=atlas', {})
  })

  it('stops waiting as soon as Hermes’s own start fails', async () => {
    hermes({ exit: 1 })
    const starting = startGateway('atlas')
    await vi.advanceTimersByTimeAsync(1500)
    expect(await starting).toBeNull()
  })

  it('gives up when it never comes up', async () => {
    // Docker turns `hermes gateway start` away and it still ends with 0.
    hermes({ exit: 0 })
    const starting = startGateway('atlas')
    await vi.advanceTimersByTimeAsync(21_000)
    expect(await starting).toBeNull()
  })

  it('takes a gateway that already serves the agent as running', async () => {
    post.mockRejectedValue(new HermesError(409, 'served by the default multiplexer'))
    get.mockResolvedValue({ gateway_running: true })
    const starting = startGateway('atlas')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await starting).toMatchObject({ gateway_running: true })
  })
})
