import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const put = vi.fn(async (_path: string, _body: unknown) => ({}))
vi.mock('@/hermes/rest', () => ({
  api: { get: (path: string) => get(path), put: (path: string, body: unknown) => put(path, body) },
}))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))

const { QUESTION_WAIT, keepQuestionWait, questionWait } = await import('./questions')

const hermes = (seconds: number) => ({ agent: { clarify_timeout: seconds } })

describe('how long an agent waits for your answer', () => {
  it('is an hour where Hermes would give up after 90 seconds (0.23.1 on)', () => {
    expect(QUESTION_WAIT).toBe(3600)
    expect(questionWait({}, hermes(90))).toBe(3600)
    expect(questionWait(undefined, hermes(90))).toBe(3600)
  })

  it('counts Hermes’s own default written into the agent’s file as no choice of the person’s', () => {
    expect(questionWait(hermes(90), hermes(90))).toBe(3600)
    expect(questionWait({ agent: { clarify_timeout: '90' } }, hermes(90))).toBe(3600)
  })

  it('keeps a wait the person set themselves', () => {
    expect(questionWait(hermes(300), hermes(90))).toBeUndefined()
    expect(questionWait(hermes(30), hermes(90))).toBeUndefined()
    expect(questionWait(hermes(0), hermes(90))).toBeUndefined()
    // The older setting wins in Hermes, so it's theirs too.
    expect(questionWait({ clarify: { timeout: 45 } }, hermes(90))).toBeUndefined()
  })

  it('leaves a Hermes that already waits an hour or more, or forever, as it is (0.23.0 and before)', () => {
    expect(questionWait({}, hermes(3600))).toBeUndefined()
    expect(questionWait({}, hermes(7200))).toBeUndefined()
    expect(questionWait({}, hermes(0))).toBeUndefined()
    expect(questionWait({}, undefined)).toBeUndefined()
  })
})

describe('keeping an agent’s wait', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockClear()
  })

  it('writes only the wait, into the agent’s own config', async () => {
    get.mockImplementation(async (path: string) => (path.includes('/defaults') ? hermes(90) : {}))
    await keepQuestionWait('scout')
    expect(put).toHaveBeenCalledWith('/api/config?profile=scout', { config: { agent: { clarify_timeout: 3600 } } })
  })

  it('writes nothing to an agent with its own wait', async () => {
    get.mockImplementation(async (path: string) => (path.includes('/defaults') ? hermes(90) : hermes(120)))
    await keepQuestionWait('ada')
    expect(put).not.toHaveBeenCalled()
  })
})
