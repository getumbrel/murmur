import { describe, expect, it } from 'vitest'
import { currentTitle, reasoningLines, titleOf } from './reasoning'

// ChatGPT's reasoning summaries, the way Hermes streams them: sections with a bold title, a blank line between.
const SUMMARY =
  '**Checking the gateway logs**\n\nI’m looking at each profile’s gateway log for errors.\n\n**Testing the OpenAI sign-in**\n\nThe default agent’s refresh token might be stale.'

describe('what the agent is thinking about', () => {
  it('is the newest section’s title', () => {
    expect(currentTitle(SUMMARY)).toBe('Testing the OpenAI sign-in')
    expect(currentTitle('**Checking the gateway logs**\n\nI’m looking')).toBe('Checking the gateway logs')
  })

  it('waits for a title to be written out', () => {
    expect(currentTitle('**Checking the gateway logs**\n\nLooking.\n\n**Testing the Op')).toBe('Checking the gateway logs')
    expect(currentTitle('**Checking the gate')).toBeNull()
    expect(currentTitle('**Checking the gateway logs**')).toBe('Checking the gateway logs')
  })

  // As ChatGPT's titles reached Murmur from a real Hermes: titles alone, back to back.
  it('finds titles that arrive with nothing between them', () => {
    expect(currentTitle('**Locating four official sources****Searching official visa site**')).toBe('Searching official visa site')
    expect(currentTitle('**Locating four official sources****Searching official')).toBe('Locating four official sources')
    expect(currentTitle('**Locating four official sources***')).toBe('Locating four official sources')
    expect(currentTitle('**Locating four official sources****')).toBe('Locating four official sources')
    expect(currentTitle('**Checking the logs**\n\nThey look clean.**Testing the sign-in**')).toBe('Testing the sign-in')
  })

  it('is nothing for reasoning in plain prose', () => {
    expect(currentTitle('The user wants a meal plan. Let me think about what **they** need.')).toBeNull()
    expect(currentTitle('')).toBeNull()
  })

  it('takes Markdown headings too, without their colon', () => {
    expect(titleOf('### Planning the week')).toBe('Planning the week')
    expect(titleOf('**Next steps:**')).toBe('Next steps')
    expect(titleOf('**Note:** this is a sentence')).toBeNull()
    expect(titleOf('- **a** list item')).toBeNull()
  })
})

describe('the reasoning, shown in full', () => {
  it('tells titles apart, sits each on its section and drops bold marks', () => {
    expect(reasoningLines('**Checking**\n\nThe **default** agent.\n\n**Testing**\n\nIts sign-in.')).toEqual([
      { title: true, text: 'Checking' },
      { title: false, text: 'The default agent.' },
      { title: false, text: '' },
      { title: true, text: 'Testing' },
      { title: false, text: 'Its sign-in.' },
    ])
  })

  it('puts titles that arrive together on lines of their own', () => {
    expect(reasoningLines('**Fetching Ente repo data****Reviewing four more docs**')).toEqual([
      { title: true, text: 'Fetching Ente repo data' },
      { title: true, text: 'Reviewing four more docs' },
    ])
    expect(reasoningLines('**Checking**\n\nThey look clean.**Testing**\n\nIts sign-in.')).toEqual([
      { title: true, text: 'Checking' },
      { title: false, text: 'They look clean.' },
      { title: false, text: '' },
      { title: true, text: 'Testing' },
      { title: false, text: 'Its sign-in.' },
    ])
  })

  it('leaves plain prose as it is', () => {
    expect(reasoningLines('First this.\n\nThen that.')).toEqual([
      { title: false, text: 'First this.' },
      { title: false, text: '' },
      { title: false, text: 'Then that.' },
    ])
  })
})
