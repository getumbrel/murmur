import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: class extends Error {} }))

const { voiceSetupError } = await import('./voice-setup')
const said = (detail: string, keyed = true) => voiceSetupError(new Error(detail), keyed)

describe('what setting up a voice says when it fails', () => {
  it('names the permission a restricted key is missing', () => {
    const body = (permission: string) =>
      `TTS chunk 1 failed (elevenlabs): status_code: 401, body: {'detail': {'status': 'missing_permissions', 'message': 'The API key you used is missing the permission ${permission} to execute this operation.'}}`
    expect(said(body('text_to_speech'))).toBe('Turn on Text to Speech for this key in ElevenLabs')
    expect(said(body('speech_to_text'))).toBe('Turn on Speech to Text for this key in ElevenLabs')
  })

  it('names it when hearing is what a key can’t do', () => {
    const hearing = 'ElevenLabs STT API error (HTTP 401): The API key you used is missing the permission speech_to_text to execute this operation.'
    expect(said(hearing)).toBe('Turn on Speech to Text for this key in ElevenLabs')
  })

  it('only blames the key when it was turned down, as ElevenLabs words it either way', () => {
    const speaking = "TTS chunk 1 failed (elevenlabs): TTS generation failed (elevenlabs): status_code: 400, body: {'detail': {'type': 'authentication_error', 'code': 'invalid_api_key', 'message': 'API key is invalid.'}}"
    expect(said(speaking)).toBe('That key didn’t work')
    expect(said('ElevenLabs STT API error (HTTP 400): API key is invalid.')).toBe('That key didn’t work')
    expect(said('ElevenLabs STT API error (HTTP 400): API key must be exactly 51 characters, got 52.')).toBe('That key didn’t work')
  })

  it('doesn’t blame the key for a Hermes without the ElevenLabs package', () => {
    const missing = "TTS chunk 1 failed (elevenlabs): ElevenLabs provider selected but 'elevenlabs' package not installed. Run: hermes pm install --extra tts-premium"
    expect(said(missing)).toBe('This Hermes can’t use ElevenLabs yet')
  })

  it('says when the plan is what’s in the way', () => {
    expect(said("status_code: 401, body: {'detail': {'status': 'quota_exceeded'}}")).toBe('Your ElevenLabs plan doesn’t cover this')
    expect(said("status_code: 402, body: {'detail': {'status': 'paid_plan_required'}}")).toBe('Your ElevenLabs plan doesn’t cover this')
  })

  it('says when it couldn’t get there at all', () => {
    expect(said('Connection error.')).toBe('Couldn’t reach ElevenLabs, try again')
  })

  it('names the service a replacement key was tried on', () => {
    const tried = (detail: string, service: string) => voiceSetupError(new Error(detail), true, service)
    expect(tried('HTTP 401 invalid_api_key text_to_speech', 'OpenAI')).toBe('That key didn’t work')
    expect(tried('HTTP 429 insufficient_quota text_to_speech', 'OpenAI')).toBe('Your OpenAI plan doesn’t cover this')
    expect(tried('connect failed', 'OpenAI')).toBe('Couldn’t reach OpenAI, try again')
    expect(tried('HTTP 401 missing_permissions speech_to_text', 'ElevenLabs')).toBe('Turn on Speech to Text for this key in ElevenLabs')
    expect(tried('invalid_api_key', 'ElevenLabs')).toBe('That key didn’t work')
    expect(tried('Not checked', 'OpenAI')).toBe('Couldn’t check that key, try again')
  })

  it('falls back on what it was doing', () => {
    expect(said('Something else')).toBe('Couldn’t check that key, try again')
    expect(said('Something else', false)).toBe('Couldn’t switch, try again')
  })
})
