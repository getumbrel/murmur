import { describe, expect, it, vi } from 'vitest'
import { umbrelTool } from '@/features/umbrel/finds'

// Only the address and naming logic is under test; the rest needs a browser and a Hermes.
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: Error }))
vi.mock('@/hermes/gateway', () => ({ rpc: () => Promise.resolve() }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => {}, rememberedSet: () => new Set() }))

const { isOtherUmbrel, otherLabel, otherUmbrelName, otherUmbrelUrl } = await import('./umbrel-mcp')

describe('another Umbrel', () => {
  it('takes an address the way people type it', () => {
    expect(otherUmbrelUrl('100.64.0.5')).toBe('http://100.64.0.5/mcp')
    expect(otherUmbrelUrl(' umbrel-pro.local ')).toBe('http://umbrel-pro.local/mcp')
    expect(otherUmbrelUrl('https://office.tail1234.ts.net')).toBe('https://office.tail1234.ts.net/mcp')
    expect(otherUmbrelUrl('http://10.0.0.9:8080/mcp')).toBe('http://10.0.0.9:8080/mcp')
    expect(otherUmbrelUrl('')).toBeNull()
    expect(otherUmbrelUrl('ftp://x')).toBeNull()
  })

  it('names it for where it is, or what you call it', () => {
    expect(otherUmbrelName('http://umbrel-pro.local/mcp')).toBe('umbrel_pro')
    expect(otherUmbrelName('https://office.tail1234.ts.net/mcp')).toBe('umbrel_office')
    expect(otherUmbrelName('http://100.64.0.5/mcp')).toBe('umbrel_other')
    expect(otherUmbrelName('http://100.64.0.5/mcp', 'Mum’s place')).toBe('umbrel_mum_s_place')
    expect(otherUmbrelName('http://100.64.0.5/mcp', 'Umbrel Pro')).toBe('umbrel_pro')
    expect(otherLabel('umbrel_pro')).toBe('Umbrel Pro')
    expect(isOtherUmbrel('umbrel_pro')).toBe(true)
    expect(isOtherUmbrel('umbrel')).toBe(false)
    expect(isOtherUmbrel('umbrel_pro-check')).toBe(false)
  })

  it('shows what another Umbrel finds as Umbrel cards', () => {
    expect(umbrelTool('mcp__umbrel_pro__search')).toEqual({ server: 'umbrel_pro', tool: 'search' })
    expect(umbrelTool('mcp__umbrel__search')).toEqual({ server: 'umbrel', tool: 'search' })
    expect(umbrelTool('mcp__github__search')).toBeNull()
  })
})
