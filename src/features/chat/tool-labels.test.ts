import { describe, expect, it } from 'vitest'
import { didSummary, foundSubjects, pastLabel, peopleOf, resultLabel, searchWords, toolLabel, tookFor } from './tool-labels'

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

describe('the browser', () => {
  const exec = (code: string) => toolLabel('browser_exec', { code })

  it('reads Hermes’s browser code as the step its comment says, and the site it opens', () => {
    expect(exec('# Opening your basket at Hearth & Bean\nnew_tab("https://www.hearth.example/cart")\nwait_for_load()')).toEqual({
      label: 'Opening your basket at Hearth & Bean',
      category: 'browser',
      detail: 'hearth.example',
    })
    expect(exec("# Searching for flights\ngoto_url('https://flights.example/?q=LIS')").detail).toBe('flights.example')
    expect(pastLabel(exec('# Opening the shop\nnew_tab("https://shop.example")').label)).toBe('Opened the shop')
  })

  it('falls back to Hermes’s own summary, then plain words', () => {
    expect(toolLabel('browser_exec', { code: 'print(page_info())' }, 'Checking the page').label).toBe('Checking the page')
    expect(exec('print(page_info())')).toEqual({ label: 'Using the browser', category: 'browser', detail: undefined })
  })

  it('reads an ask for a hand as what the agent asked, in full', () => {
    const reason = 'Confirm you’re a person on Hearth & Bean, then I’ll place the order for you.'
    expect(toolLabel('ask_for_a_hand', { reason })).toMatchObject({ label: 'Asking you for a hand', detail: reason })
  })

  it('knows how long the person had the browser, once they handed it back', () => {
    expect(tookFor('ask_for_a_hand', { handed_back: true, seconds: 42, note: '…' })).toBe(42_000)
    expect(tookFor('ask_for_a_hand', JSON.stringify({ handed_back: true, seconds: 3 }))).toBe(3_000)
    expect(tookFor('ask_for_a_hand', { handed_back: false, note: 'Nobody took over' })).toBeUndefined()
    expect(tookFor('browser_exec', { handed_back: true, seconds: 1 })).toBeUndefined()
  })
})

describe('a machine’s keyboard and mouse', () => {
  const drive = (args: Record<string, unknown>) => toolLabel('mcp__umbrel__control_machine', { machineId: 'ubuntu-desktop', ...args })

  it('says what the agent does there (its screen, below, says which machine)', () => {
    expect(drive({ action: 'left_click', coordinate: [1, 2] })).toEqual({ label: 'Clicking', category: 'machine' })
    expect(drive({ action: 'type', text: 'sudo apt install firefox' }).label).toBe('Typing ‘sudo apt install firefox’')
    expect(drive({ action: 'key', text: 'ctrl+alt+Delete' }).label).toBe('Pressing Ctrl+Alt+Delete')
    expect(drive({ action: 'key', text: 'Return' }).label).toBe('Pressing Return')
    expect(drive({ action: 'scroll', scrollDirection: 'down' }).label).toBe('Scrolling down')
    expect(drive({ action: 'double_click' }).label).toBe('Double-clicking')
    expect(toolLabel('mcp__umbrel__get_machine_screenshot', { machineId: 'win-11' }).label).toBe('Looking at the screen')
  })

  it('reads in the past once done, and sums up as using a machine', () => {
    expect(pastLabel('Double-clicking')).toBe('Double-clicked')
    expect(pastLabel('Typing ‘hi’')).toBe('Typed ‘hi’')
    expect(pastLabel('Looking at the screen')).toBe('Looked at the screen')
    expect(didSummary(['mcp__umbrel__get_machine_screenshot', 'mcp__umbrel__control_machine'])).toBe('Used a machine')
    expect(didSummary(['mcp__umbrel__start_machine'])).toBe('Used your Umbrel')
  })
})

describe('a question the agent asked you', () => {
  const timedOut = {
    responses: [{ question: 'Which colour?', status: 'unanswered', user_response: null }],
    outcome: 'timed_out',
  }

  it('reads as unanswered once the agent stopped waiting, from the live result or the saved one', () => {
    expect(pastLabel(resultLabel('clarify', timedOut)!)).toBe('Asked you, no answer')
    const saved = `<untrusted_tool_result source="clarify">\nRetrieved from a tool.\n\n${JSON.stringify(timedOut)}\n</untrusted_tool_result>`
    expect(resultLabel('clarify', saved)).toBe('Asking you, no answer')
    // An older Hermes's note.
    expect(resultLabel('clarify', '[user did not respond within 60 minutes]')).toBe('Asking you, no answer')
  })

  it('reads as it did when it was answered, or the reply stopped', () => {
    const answered = { responses: [{ status: 'answered', user_response: 'Slate' }], outcome: 'submitted' }
    expect(resultLabel('clarify', answered)).toBeUndefined()
    expect(resultLabel('clarify', { responses: [], outcome: 'cancelled' })).toBeUndefined()
  })
})
