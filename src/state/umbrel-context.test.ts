import { describe, expect, it, vi } from 'vitest'

// Only the config logic is under test; the rest needs a browser and a Hermes.
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/hermes/rest', () => ({ api: {} }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => {}, rememberedSet: () => new Set() }))

const { umbrelContextOf, umbrelContextPatch } = await import('./umbrel-context')

// The main agent's config as Umbrel's Hermes image leaves it.
const MAIN = {
  plugins: { enabled: ['umbrel-runtime'] },
  skills: { external_dirs: ['/app/umbrel-context/skills'] },
}

describe('umbrel context', () => {
  it('reads what the main agent has on an Umbrel, and nothing elsewhere', () => {
    expect(umbrelContextOf(MAIN)).toEqual({ plugin: true, skills: ['/app/umbrel-context/skills'] })
    expect(umbrelContextOf({ skills: { external_dirs: ['~/.agents/skills'] } })).toEqual({ plugin: false, skills: [] })
    expect(umbrelContextOf(undefined)).toEqual({ plugin: false, skills: [] })
  })

  it('gives a fresh agent both', () => {
    expect(umbrelContextPatch(umbrelContextOf(MAIN), {})).toEqual({
      plugins: { enabled: ['umbrel-runtime'] },
      skills: { external_dirs: ['/app/umbrel-context/skills'] },
    })
  })

  it("keeps an agent's own plugins and skill folders", () => {
    const agent = { plugins: { enabled: ['disk-cleanup'] }, skills: { external_dirs: ['~/team-skills'] } }
    expect(umbrelContextPatch(umbrelContextOf(MAIN), agent)).toEqual({
      plugins: { enabled: ['disk-cleanup', 'umbrel-runtime'] },
      skills: { external_dirs: ['~/team-skills', '/app/umbrel-context/skills'] },
    })
  })

  it('leaves an agent alone once it has it, or switched the plugin off', () => {
    expect(umbrelContextPatch(umbrelContextOf(MAIN), MAIN)).toBeNull()
    const off = { plugins: { disabled: ['umbrel-runtime'] }, skills: MAIN.skills }
    expect(umbrelContextPatch(umbrelContextOf(MAIN), off)).toBeNull()
  })

  it('does nothing off an Umbrel', () => {
    expect(umbrelContextPatch(umbrelContextOf({}), {})).toBeNull()
  })
})
