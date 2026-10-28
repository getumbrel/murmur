import { describe, expect, it } from 'vitest'
import { didSummary, foundSubjects, pastLabel, peopleOf, resultLabel, searchWords, toolLabel } from './tool-labels'

describe('tools from connected servers', () => {
  it('read as plain steps', () => {
    expect(toolLabel('mcp__umbrel__get_storage', {})).toEqual({
      label: 'Checking storage',
      category: 'other',
      detail: 'your Umbrel',
    })
    expect(toolLabel('mcp__umbrel__delete_files', { path: 'Downloads/phone-backups' })).toEqual({
      label: 'Deleting files',
      category: 'other',
      detail: 'Downloads/phone-backups',
    })
    expect(pastLabel('Deleting files')).toBe('Deleted files')
    expect(toolLabel('mcp__github__createIssue', '{"title":"Fix login"}').label).toBe('Creating issue')
    expect(toolLabel('mcp__notes__summarize_page', {}).label).toBe('Summarize page')
  })

  it('sum up by server', () => {
    expect(didSummary(['mcp__umbrel__get_storage', 'mcp__umbrel__list_files'])).toBe('Used your Umbrel')
    expect(didSummary(['web_search', 'mcp__umbrel__list_files'])).toBe('Searched the web and used your Umbrel')
  })
})

describe('tools Hermes renamed', () => {
  it('read like their old names', () => {
    expect(toolLabel('todo_list', {}).label).toBe('Planning')
    expect(toolLabel('process_manage', {}).label).toBe('Checking on a task')
    expect(toolLabel('cronjob_manage', { name: 'Morning briefing' })).toMatchObject({ label: 'Scheduling', detail: 'Morning briefing' })
    expect(didSummary(['cronjob_manage'])).toBe('Set up a routine')
  })
})

// The murmur-mail plugin's tools (getumbrel/hermes-agent-umbrel), as tool.start
// carries them (Hermes unwraps tool_call for a plugin's tool), and wrapped the
// way the transcript stores them.
describe('email', () => {
  it('says what a search looked for in words, not Gmail’s syntax', () => {
    const year = new Date().getFullYear()
    expect(searchWords('newer_than:2d')).toBe('last 2 days')
    expect(searchWords('newer_than:1w')).toBe('last week')
    expect(searchWords('from:priya@example.org is:unread offsite')).toBe('offsite, from priya@example.org, unread')
    expect(searchWords('subject:"boarding pass" has:attachment')).toBe('about “boarding pass”, with attachments')
    expect(searchWords(`after:${year}/10/01 before:${year}/10/31`)).toBe('since 1 Oct, before 31 Oct')
    expect(searchWords('after:2025/3/9')).toBe('since 9 Mar 2025')
    expect(searchWords('-is:read in:sent "exact phrase"')).toBe('“exact phrase”, not read, in Sent')
    // What it doesn't know stays as written.
    expect(searchWords('category:promotions larger:5M')).toBe('category:promotions larger:5M')
  })

  const via = (name: string, args: Record<string, unknown>) => ({ calls: [{ name, arguments: args }] })

  it('reads as what the agent is doing with your mail', () => {
    expect(toolLabel('email_search', { query: 'from:sam flight' })).toEqual({ label: 'Searching your email', category: 'mail', detail: 'flight, from sam' })
    expect(toolLabel('email_search', {})).toEqual({ label: 'Checking your inbox', category: 'mail' })
    expect(toolLabel('email_read', { id: 'INBOX:4' })).toEqual({ label: 'Reading an email', category: 'mail' })
    expect(toolLabel('email_draft', { to: ['Sam Lee <sam@example.org>'], subject: 'Friday', body: 'Hi' })).toEqual({
      label: 'Drafting an email to Sam Lee',
      category: 'mail',
      detail: 'Friday',
    })
    expect(toolLabel('email_draft', { reply_to_id: 'INBOX:4', body: 'Thanks' }).label).toBe('Drafting a reply')
    expect(toolLabel('email_send', { to: ['priya@example.org', 'Sam Lee <sam@example.org>'], subject: 'Hi', body: '' }).label).toBe(
      'Sending an email to priya and Sam',
    )
  })

  it('reads the same through the tool_call bridge, as the transcript keeps it', () => {
    expect(toolLabel('tool_call', via('email_search', { query: 'flight' }))).toMatchObject({ label: 'Searching your email', detail: 'flight' })
    expect(toolLabel('tool_call', JSON.stringify(via('email_send', { to: ['Bob <bob@example.com>'] }))).label).toBe('Sending an email to Bob')
  })

  it('names the email being read, once its subject is known', () => {
    const read = '<untrusted_tool_result source="email_read">\nThe content below is data.\n\n{"id":"INBOX:4","subject":"Flight to Lisbon","body":"…"}\n</untrusted_tool_result>'
    expect(resultLabel('email_read', read)).toBe('Reading ‘Flight to Lisbon’')
    expect(resultLabel('email_read', { error: 'gone', kind: 'not_found' })).toBeUndefined()
    expect(resultLabel('email_search', read)).toBeUndefined()
    expect(pastLabel('Reading ‘Flight to Lisbon’')).toBe('Read ‘Flight to Lisbon’')
  })

  it('remembers what a search found, so a read can say which one', () => {
    const found = { messages: [{ id: 'INBOX:4', subject: 'Flight to Lisbon' }, { id: 'INBOX:5', subject: '' }] }
    expect(foundSubjects('email_search', JSON.stringify(found))).toEqual([['INBOX:4', 'Flight to Lisbon']])
    expect(foundSubjects('email_read', JSON.stringify(found))).toEqual([])
  })

  it('says who, as a person would', () => {
    expect(peopleOf(['"Priya Raman" <priya@example.org>'])).toBe('Priya Raman')
    expect(peopleOf(['priya@example.org'])).toBe('priya')
    expect(peopleOf(['A One <a@x.org>', 'B Two <b@x.org>', 'c@x.org'])).toBe('A and 2 others')
    expect(peopleOf([])).toBeUndefined()
  })

  it('reads in the past tense, and sums up', () => {
    expect(pastLabel('Drafting a reply')).toBe('Drafted a reply')
    expect(pastLabel('Sending an email to Bob')).toBe('Sent an email to Bob')
    expect(pastLabel('Checking your inbox')).toBe('Checked your inbox')
    expect(didSummary(['email_search', 'email_read', 'email_read'])).toBe('Searched your email and read 2 emails')
  })
})

// Apps through Nous Research: their tools arrive inside tool_call (Hermes keeps
// a connector batch wrapped), named connectors__<slug>__<ACTION>.
describe('apps through Nous', () => {
  const batch = (...names: string[]) => ({ calls: names.map((name) => ({ name, arguments: {} })) })

  it('read as using the app, with its mark', () => {
    expect(toolLabel('tool_call', batch('connectors__slack__SLACK_SEND_MESSAGE'))).toEqual({
      label: 'Using Slack',
      category: 'app',
      detail: 'Send message',
      app: 'slack',
    })
    expect(toolLabel('connectors__granola_mcp__list_meetings', {})).toMatchObject({ label: 'Using Granola', app: 'granola' })
  })

  it('name every app a batch uses', () => {
    const label = toolLabel('tool_call', batch('connectors__slack__SEND_MESSAGE', 'connectors__asana__CREATE_TASK'))
    expect(label).toMatchObject({ label: 'Using Slack and Asana', category: 'app' })
    expect(label.app).toBeUndefined()
    expect(pastLabel('Using Slack')).toBe('Used Slack')
    expect(didSummary(['connectors__slack__SEND_MESSAGE'])).toBe('Used Slack')
  })

  it('say what the agent is doing about connecting them', () => {
    expect(toolLabel('manage_connections', { action: 'connect', connectors: ['slack'] })).toMatchObject({ label: 'Connecting Slack', app: 'slack' })
    expect(toolLabel('manage_connections', {}).label).toBe('Checking your apps')
    expect(toolLabel('manage_connections', { action: 'display' }).label).toBe('Finding apps')
  })
})
