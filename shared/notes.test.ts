import { describe, expect, it } from 'vitest'
import { askNote, askText, firstLine, groupAskNote, groupNote, replyNote, runNote } from './notes.ts'

const chat = { id: '20261014_101500_abc', profile: 'atlas' }

describe('firstLine', () => {
  it('takes the first line of words', () => {
    expect(firstLine('Done! I booked the table.\n\nMore details below.')).toBe('Done! I booked the table.')
  })

  it('drops markdown, code and files', () => {
    expect(firstLine('## **Your plan**\n- one')).toBe('Your plan')
    expect(firstLine('```sh\nrm -rf /\n```\nRan it for you.')).toBe('Ran it for you.')
    expect(firstLine('See [the docs](https://x.y) and `npm test`.')).toBe('See the docs and npm test.')
    expect(firstLine('MEDIA:/opt/data/cache/chart.png\nHere’s the chart.')).toBe('Here’s the chart.')
    expect(firstLine('---\n| a | b |\n|---|---|')).toBe('a b')
  })

  it('keeps it short', () => {
    const line = firstLine('word '.repeat(80))
    expect(line.length).toBeLessThanOrEqual(140)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('replyNote', () => {
  it('names the agent and quotes the reply', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there.\nHow can I help?' },
    ]
    expect(replyNote('Atlas', chat, messages)).toEqual({
      title: 'Atlas',
      body: 'Hello there.',
      tag: 'murmur:chat:20261014_101500_abc',
      href: '/chat/atlas/20261014_101500_abc',
    })
  })

  it('quotes the words after the work', () => {
    const messages = [
      { role: 'user', content: 'tidy up' },
      { role: 'assistant', content: null },
      { role: 'tool', content: '{"exit_code": 0}' },
      { role: 'assistant', content: 'All tidy.' },
    ]
    expect(replyNote('Atlas', chat, messages)?.body).toBe('All tidy.')
  })

  it('says nothing when the last message was never answered (stopped or failed)', () => {
    expect(replyNote('Atlas', chat, [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'First' }, { role: 'user', content: 'two' }])).toBeNull()
    expect(replyNote('Atlas', chat, [])).toBeNull()
  })

  it('never quotes an earlier reply', () => {
    const messages = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: '' },
    ]
    expect(replyNote('Atlas', chat, messages)?.body).toBe('Finished')
  })
})

describe('asks', () => {
  it('asks for an OK, or asks the question', () => {
    expect(askText('approval', { command: 'rm -rf /tmp/x', pattern_keys: ['recursive delete'] })).toBe('Wants to run “rm -rf /tmp/x”')
    expect(askText('approval', {})).toBe('Needs your OK')
    expect(askText('clarify', { questions: [{ qid: 'q0', question: 'Which day works?' }] })).toBe('Which day works?')
    expect(askText('clarify', { question: 'Red or blue?' })).toBe('Red or blue?')
    expect(askText('clarify', { questions: [] })).toBe('Has a question for you')
  })

  it('says what a masked prompt is for', () => {
    expect(askText('vault.save_login', { site: 'example.com' })).toBe('Needs your login for example.com')
    expect(askText('vault.code', {})).toBe('Needs a sign-in code')
    expect(askText('secret', { env_var: 'WEATHER_KEY', metadata: { skill_name: 'weather' } })).toBe('Needs a key for weather')
  })

  it('names only a command, never what a tool, a card, an email or a plugin asks', () => {
    const asks = [
      { command: "MCP tool 'delete_files' on UNTRUSTED server 'umbrel' wants to run", pattern_keys: ['mcp_elicitation'] },
      { command: "Fill payment card 'Visa •••• 4242' on https://www.bestbuy.com", pattern_keys: ['mcp_elicitation'] },
      { command: 'send', pattern_keys: ['plugin_rule:murmur-mail-send:abc'] },
      { command: '<terminal> (plugin approval rule)', pattern_keys: ['plugin_rule:contract'] },
      { command: '<write to ~/.ssh/config>', pattern_key: 'ssh_config_write' },
    ]
    for (const params of asks) expect(askText('approval', params)).toBe('Needs your OK')
  })

  it('fits a long command or a script on a line a phone shows, its quotes closed', () => {
    const long = askText('approval', { command: `curl -fsSL https://example.com/install.sh | sh -s -- ${'--flag '.repeat(20)}` })!
    expect(long).toMatch(/^Wants to run “curl -fsSL https:\/\/example\.com\/install\.sh \| sh -s -- --flag .*…”$/)
    expect(long.length).toBeLessThanOrEqual(140)
    expect(askText('approval', { command: 'cd ~/site\nnpm run build\nrm -rf ./dist' })).toBe('Wants to run “cd ~/site…”')
  })

  it('leaves out what Murmur can’t answer', () => {
    expect(askText('terminal.read', {})).toBeUndefined()
    expect(askText('sudo', {})).toBeUndefined()
  })

  it('opens the chat', () => {
    expect(askNote('Atlas', chat, 'Needs your OK')).toEqual({
      title: 'Atlas',
      body: 'Needs your OK',
      tag: 'murmur:chat:20261014_101500_abc',
      href: '/chat/atlas/20261014_101500_abc',
    })
  })
})

describe('groupNote', () => {
  it('quotes the last word from the group', () => {
    expect(groupNote({ id: 'room 1', name: 'Trip', lastLine: 'Atlas: Sounds good' })).toEqual({
      title: 'Trip',
      body: 'Atlas: Sounds good',
      tag: 'murmur:group:room 1',
      href: '/group/room%201',
    })
  })

  it('says nothing when you had the last word', () => {
    expect(groupNote({ id: 'g', name: 'Trip', lastLine: 'You: anyone?' })).toBeNull()
    expect(groupNote({ id: 'g', name: 'Trip', lastLine: '' })).toBeNull()
  })

  it('says who needs an OK', () => {
    expect(groupAskNote({ id: 'g', name: 'Trip' }, 'Atlas')).toMatchObject({ title: 'Trip', body: 'Atlas needs your OK', href: '/group/g' })
  })
})

describe('runNote', () => {
  it('names the routine and quotes what it found', () => {
    const note = runNote({ agentId: 'atlas', runId: 'cron_abc123_20261020_080000', routine: 'Morning brief', text: '## Three things today\n- Rain at 4' })
    expect(note).toEqual({
      title: 'Morning brief',
      body: 'Three things today',
      tag: 'murmur:chat:cron_abc123_20261020_080000',
      href: '/chat/atlas/cron_abc123_20261020_080000',
    })
  })

  it('says nothing when there are no words to quote', () => {
    expect(runNote({ agentId: 'atlas', runId: 'r', routine: 'Brief', text: '```\n```' })).toBeNull()
  })

  it('keeps the title to a line, since a routine with no name is titled with its whole prompt', () => {
    const routine = 'Every morning, check my calendar and\nthe weather, and tell me what to wear and when to leave'
    const { title } = runNote({ agentId: 'atlas', runId: 'r', routine, text: 'Rain at 4' })!
    expect(title).toBe('Every morning, check my calendar and the weather, and tell…')
    expect(title.length).toBeLessThanOrEqual(60)
  })
})
