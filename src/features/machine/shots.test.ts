import { describe, expect, it } from 'vitest'
import { toolMedia } from '@/features/media/tool-media'
import { machineName, placeScreens, shotOf, type Shot } from './shots'

// As Hermes reports umbrelOS's machine tools: the tool's text in {"result": …},
// the screenshot cached and named on a MEDIA: line after it.
const result = (value: unknown, media = '/opt/data/cache/images/mcp_1.jpg') => ({
  result: `${JSON.stringify(value, null, 2)}\nMEDIA:${media}`,
})
const screenshot = { width: 1280, height: 800, mimeType: 'image/jpeg' }

describe('a machine’s screenshots', () => {
  it('reads the picture, its size and where a click pressed', () => {
    const shot = shotOf(
      'mcp__umbrel__control_machine',
      { machineId: 'ubuntu-desktop', action: 'left_click', coordinate: [640, 400] },
      result({ machineId: 'ubuntu-desktop', action: 'left_click', screenshot }),
    )
    expect(shot).toEqual({
      key: 'umbrel/ubuntu-desktop',
      machine: 'ubuntu-desktop',
      path: '/opt/data/cache/images/mcp_1.jpg',
      w: 1280,
      h: 800,
      at: [640, 400],
    })
  })

  it('marks no press for typing or a look, and finds the machine on any server', () => {
    const typed = shotOf(
      'mcp__machines__control_machine',
      JSON.stringify({ machineId: 'win', action: 'type', text: 'hi', coordinate: [10, 10] }),
      result({ machineId: 'win', action: 'type', screenshot }),
    )
    expect(typed).toMatchObject({ key: 'machines/win' })
    expect(typed?.at).toBeUndefined()
    expect(shotOf('mcp__umbrel__get_machine_screenshot', { machineId: 'win' }, result({ machineId: 'win', screenshot }))?.at).toBeUndefined()
  })

  it('reads a stored result, wrapped as untrusted data', () => {
    const stored = `<untrusted_tool_result source="mcp">\nThe tool said:\n\n${JSON.stringify(result({ machineId: 'win', screenshot }))}\n</untrusted_tool_result>`
    expect(shotOf('mcp__umbrel__get_machine_screenshot', {}, stored)).toMatchObject({ machine: 'win', w: 1280 })
  })

  it('is nothing for other tools, or a failure with no picture', () => {
    expect(shotOf('mcp__umbrel__get_photo', {}, result({ id: 'x' }))).toBeNull()
    expect(shotOf('mcp__umbrel__control_machine', { machineId: 'win' }, { result: 'Error: [machine-not-running]' })).toBeNull()
  })

  it('keeps them out of the pictures shown under each step', () => {
    expect(toolMedia('mcp__umbrel__control_machine', result({ machineId: 'win', screenshot }))).toEqual([])
    expect(toolMedia('mcp__other__screenshot', result({ ok: true }, '/opt/data/a.png'))).toEqual(['/opt/data/a.png'])
  })

  it('names a machine from its id', () => {
    expect(machineName('ubuntu-desktop')).toBe('Ubuntu Desktop')
    expect(machineName('windows-11')).toBe('Windows 11')
  })
})

describe('placing screens in a reply', () => {
  const shot = (key: string, n: number): Shot => ({ key, machine: key, path: `/${key}/${n}.jpg` })

  it('shows each machine once, under the run that last showed it, with every picture so far', () => {
    const placed = placeScreens([[shot('a', 1), shot('a', 2)], [], [shot('b', 1)], [shot('a', 3)]])
    expect(placed[0]).toEqual([])
    expect(placed[2].map((s) => s.key)).toEqual(['b'])
    expect(placed[3]).toEqual([{ key: 'a', machine: 'a', shots: [shot('a', 1), shot('a', 2), shot('a', 3)] }])
  })
})
