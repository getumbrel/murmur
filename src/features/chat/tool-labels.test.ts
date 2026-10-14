import { describe, expect, it } from 'vitest'
import { didSummary, pastLabel, toolLabel } from './tool-labels'

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
