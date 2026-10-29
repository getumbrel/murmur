import { describe, expect, it } from 'vitest'
import { approvalText, detailOf, isCallTo, summarize, toolAsked } from './approval-text'
import type { ApprovalChoice } from './types'

// As Hermes v2026.9.24 sends it for a tool on a `trust: untrusted` MCP server.
const UMBREL = {
  command:
    "MCP tool 'delete_files' on UNTRUSTED server 'umbrel' wants to run. This tool is write-capable (no readOnlyHint=true annotation) and may modify external state.",
  description:
    "Server 'umbrel' is configured 'trust: untrusted'. Approve to run 'delete_files' once, or deny to block it.",
  patternKeys: ['mcp_elicitation'],
  choices: ['once', 'session', 'always', 'deny'] as const,
}

describe('approvalText', () => {
  it('keeps commands as commands', () => {
    expect(
      approvalText({ who: 'Hermes', command: 'rm -rf /tmp/x', choices: ['once', 'session', 'always', 'deny'] }),
    ).toEqual({
      title: 'Hermes wants to run a command',
      command: 'rm -rf /tmp/x',
      choices: ['once', 'session', 'always', 'deny'],
    })
  })

  it('retells a tool on an untrusted server in plain words', () => {
    const call = { name: 'mcp__umbrel__delete_files', args: { path: 'Downloads/phone-backups' } }
    expect(approvalText({ who: 'Hermes', ...UMBREL, choices: [...UMBREL.choices], call })).toEqual({
      title: 'Hermes wants to delete files on your Umbrel',
      command: 'Downloads/phone-backups',
      choices: ['once', 'deny'],
      tool: 'delete_files',
    })
  })

  it('waits for the call when the request comes first', () => {
    const text = approvalText({ who: 'Hermes', ...UMBREL, choices: [...UMBREL.choices] })
    expect(text.command).toBeUndefined()
    expect(toolAsked(UMBREL.command)).toBe('delete_files')
    expect(isCallTo('mcp__umbrel__delete_files', 'delete_files')).toBe(true)
    expect(isCallTo('mcp__umbrel__undelete_files', 'delete_files')).toBe(false)
    expect(detailOf({ name: 'mcp__umbrel__get_storage', context: 'Umbrel · get storage' })).toBe('Umbrel · get storage')
  })

  it('names other servers', () => {
    const text = approvalText({ command: "MCP tool 'createIssue' on UNTRUSTED server 'github' wants to run." })
    expect(text.title).toBe('Your agent wants to create issue in Github')
  })

  it("shows a tool's own question as a sentence", () => {
    expect(
      approvalText({ who: 'Ada', command: 'Delete 3 files from Downloads?', patternKeys: ['mcp_elicitation'] }),
    ).toEqual({
      title: 'Ada needs your OK',
      command: 'Delete 3 files from Downloads?',
      prose: true,
      choices: ['once', 'deny'],
    })
  })

  // As Hermes 0.22 sends them: a stand-in where the command goes, and what it's about in the description.
  const ALL: ApprovalChoice[] = ['once', 'session', 'always', 'deny']

  it("shows a plugin's reason, never its stand-in", () => {
    const plugin = {
      command: '<terminal> (plugin approval rule)',
      description: 'Pushing to main needs a person to sign off',
      patternKeys: ['plugin_rule:git-push'],
      choices: ALL,
    }
    expect(approvalText({ who: 'Ada', ...plugin })).toEqual({
      title: 'Ada needs your OK',
      command: 'Pushing to main needs a person to sign off',
      prose: true,
      choices: ALL,
    })
  })

  it('says which tool a plugin asked about when it gave no reason', () => {
    const plugin = { command: '<terminal> (plugin approval rule)', patternKeys: ['plugin_rule:terminal'] }
    expect(approvalText({ ...plugin, description: 'Plugin requires approval for terminal' }).command).toBe(
      'Running a command',
    )
    expect(
      approvalText({ ...plugin, description: 'Plugin requires approval for mcp__umbrel__delete_files' }).command,
    ).toBe('Deleting files')
  })

  it('names the file for writes Hermes asks about', () => {
    const ssh = {
      command: '<write to /opt/data/home/.ssh/config>',
      description:
        'Write to SSH client config file(s): /opt/data/home/.ssh/config. The SSH config can carry ProxyCommand / Match exec directives that run commands, so writes require your approval.',
      patternKeys: ['ssh_config_write'],
      choices: ALL,
    }
    expect(approvalText({ who: 'Ada', ...ssh })).toEqual({
      title: 'Ada wants to edit SSH settings',
      command: '/opt/data/home/.ssh/config',
      choices: ALL,
    })
    const instructions = {
      command: '<write to AGENTS.md>',
      description:
        'Write to protected agent-instruction file(s): AGENTS.md. These files steer future agent behavior; approval is always required (not bypassed by auto-approve).',
      patternKeys: ['protected_instruction_file'],
      choices: ['once', 'deny'] as ApprovalChoice[],
    }
    expect(approvalText({ who: 'Ada', ...instructions })).toEqual({
      title: 'Ada wants to edit agent instructions',
      command: 'AGENTS.md',
      choices: ['once', 'deny'],
    })
  })

  it("reads a check it doesn't know by its own words, but keeps commands that start with <", () => {
    expect(
      approvalText({ command: '<deploy> (new rule)', description: 'Deploys need your OK', patternKeys: ['new_rule'] }),
    ).toMatchObject({
      title: 'Your agent needs your OK',
      command: 'Deploys need your OK',
      prose: true,
    })
    expect(approvalText({ command: '< /dev/zero > /dev/sda', description: 'disk write' })).toMatchObject({
      title: 'Your agent wants to run a command',
      command: '< /dev/zero > /dev/sda',
    })
  })
})

describe('summarize', () => {
  it('lists strings, shortens long lists and labels values', () => {
    expect(summarize({ path: 'Downloads/phone-backups', recursive: true })).toBe(
      'Downloads/phone-backups · recursive: true',
    )
    expect(summarize(JSON.stringify({ ids: ['a', 'b', 'c', 'd', 'e'] }))).toBe('a, b, c and 2 more')
    expect(summarize({})).toBeUndefined()
  })
})

// The murmur-mail plugin asks before every send (getumbrel/hermes-agent-umbrel),
// with the whole message in the description and a per-message pattern key.
describe('sending an email', () => {
  const send = {
    command: '<email_send> (plugin approval rule)',
    description:
      'Send an email from ada@example.com\nTo: Priya Raman <priya@example.org>\nCc: sam@example.org\nSubject: Lunch on Thursday\n\nHi Priya,\n\nLunch on Thursday at 1?',
    patternKeys: ['plugin_rule:murmur-mail-send:0123456789abcdef0123456789abcdef'],
    choices: ['once', 'session', 'always', 'deny'] as ApprovalChoice[],
  }

  it('asks to send this email, to whom, and shows all of it', () => {
    expect(approvalText({ who: 'Ada', ...send })).toEqual({
      title: 'Send this email to Priya Raman?',
      command: 'Lunch on Thursday',
      prose: true,
      choices: ['once', 'deny'],
      tool: 'email_send',
      email: {
        from: 'ada@example.com',
        to: ['Priya Raman <priya@example.org>'],
        cc: ['sam@example.org'],
        bcc: [],
        subject: 'Lunch on Thursday',
        body: 'Hi Priya,\n\nLunch on Thursday at 1?',
      },
    })
  })

  it('never offers a yes that lasts: each email is its own', () => {
    expect(approvalText(send).choices).toEqual(['once', 'deny'])
  })

  it('stays a plugin’s plain question when it isn’t an email', () => {
    expect(approvalText({ ...send, description: 'Deploys need your OK' }).email).toBeUndefined()
  })
})

// Hermes asks before it fills in a saved card, naming the page it's on.
describe('paying with a saved card', () => {
  const fill = {
    command: "Fill payment card 'Visa •••• 4242' on https://www.bestbuy.com",
    description: 'The agent wants to enter your saved card details into this checkout page.',
    patternKeys: ['mcp_elicitation'],
    choices: ['once', 'session', 'always', 'deny'] as ApprovalChoice[],
  }

  it('shows the site and the card, with what Hermes knows of the site', () => {
    const payment = {
      card: 'Visa •••• 4242',
      origin: 'https://www.bestbuy.com',
      site: 'bestbuy.com',
      any_site: true,
      first_time: true,
    }
    expect(approvalText({ who: 'Ada', ...fill, payment })).toEqual({
      title: 'Ada wants to pay with your card',
      command: 'www.bestbuy.com',
      prose: true,
      choices: ['once', 'deny'],
      payment: { card: 'Visa •••• 4242', host: 'www.bestbuy.com', site: 'bestbuy.com', first: true },
    })
  })

  it('reads the card and the site from the words of a Hermes that sends nothing more', () => {
    expect(approvalText({ who: 'Ada', ...fill }).payment).toEqual({ card: 'Visa •••• 4242', host: 'www.bestbuy.com' })
    expect(approvalText({ ...fill, command: "Fill payment card 'Visa' on http://127.0.0.1:8765" }).payment?.host).toBe(
      '127.0.0.1:8765',
    )
  })

  it('is only Hermes’s own card fill', () => {
    expect(approvalText({ ...fill, patternKeys: [] }).payment).toBeUndefined()
    expect(approvalText({ ...fill, command: 'Fill payment card on a page' }).payment).toBeUndefined()
  })
})
