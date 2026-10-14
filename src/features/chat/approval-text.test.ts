import { describe, expect, it } from 'vitest'
import { approvalText, detailOf, isCallTo, summarize, toolAsked } from './approval-text'

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
