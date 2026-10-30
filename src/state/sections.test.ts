import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Agent, Profile } from './agents'
import type { Section } from './sections'

vi.mock('@/hermes/rest', () => ({ api: {} }))
vi.mock('@/hermes/compat', () => ({ listProfiles: vi.fn(), listProfileNames: vi.fn() }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(), gateway: {} }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('./timezone', () => ({ ensureAgentTimezone: vi.fn() }))
vi.mock('./toolsets', () => ({ hideDesktopToolsets: vi.fn() }))
vi.mock('./umbrel-context', () => ({ ensureUmbrelContext: vi.fn() }))
vi.mock('./umbrel-mcp', () => ({ ensureUmbrelMcp: vi.fn() }))
vi.mock('./agents', async () => {
  // The roster's own reading of a profile, so an agent read again lands as the roster has it.
  const { agentsKey, toAgent, readAgent, writeMeta } = await vi.importActual<typeof import('./agents')>('./agents')
  return { agentsKey, toAgent, readAgent, writeMeta, useAgents: vi.fn() }
})

const { createSection, deleteSection, editSection, file, moveSection, sectionOf, sectionsOf, useSectionWrites } =
  await import('./sections')
const { agentsKey } = await import('./agents')
const { rpc } = (await import('@/hermes/gateway')) as unknown as { rpc: ReturnType<typeof vi.fn> }
const { listProfiles } = (await import('@/hermes/compat')) as unknown as { listProfiles: ReturnType<typeof vi.fn> }

/** Hermes took the write, and says which revision each record is at now. */
const saved = (revisions?: Record<string, number>) => ({
  ok: true,
  applied: { ui_meta: true, ...(revisions && { ui_meta_revisions: revisions }) },
})
/** Hermes turned the write down: somebody wrote that record since Murmur read it. */
const conflict = (key: string) => ({
  ok: true,
  applied: { ui_meta: false, ui_meta_conflicts: { [key]: { expected: 0, actual: 1 } } },
})

beforeEach(() => {
  rpc.mockReset().mockResolvedValue(saved())
  listProfiles.mockReset()
})

const agent = (id: string, more: Partial<Agent> = {}): Agent => ({
  id,
  name: id,
  hue: 0,
  role: '',
  isDefault: false,
  ...more,
})
/** The main agent, holding Murmur's list. */
const mainAgent = (sections: unknown, more: Partial<Agent> = {}) =>
  agent('default', {
    isDefault: true,
    botMeta: { title: 'Hermes' },
    murmurMeta: { hue: 210 },
    sectionsMeta: sections,
    ...more,
  })
/** Where Hermes Desktop says an agent sits. */
const at = (s: Section | null) => ({ sectionId: s?.id ?? null, sectionName: s?.name ?? null })

const work: Section = { id: 'work', name: 'Work', groups: ['g1'] }
const home: Section = { id: 'home', name: 'Home', groups: ['g2'] }
const side: Section = { id: 'side', name: 'Side projects', groups: [] }

/**
 * A query cache holding the roster: Atlas and Echo on Work, Pip on Home, Scout
 * on none. `extra` adds agents, or stands in for the one with the same id.
 */
function roster(sections: unknown = [work, home], extra: Agent[] = []) {
  const base = [
    mainAgent(sections),
    agent('atlas', { botMeta: { title: 'Atlas', avatar: 'owl', ...at(work) } }),
    agent('echo', { botMeta: { title: 'Echo', ...at(work) } }),
    agent('pip', { botMeta: { title: 'Pip', ...at(home) } }),
    agent('scout', { botMeta: { title: 'Scout', color: '#4f8' } }),
  ]
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  qc.setQueryData<Agent[]>(agentsKey, [
    ...base.map((a) => extra.find((e) => e.id === a.id) ?? a),
    ...extra.filter((e) => !base.some((a) => a.id === e.id)),
  ])
  return qc
}
/** Each agent's ui_meta revisions, as a current Hermes lists them. */
const revise = (qc: QueryClient, revisions: Record<string, Record<string, number>>) =>
  qc.setQueryData<Agent[]>(agentsKey, (list) =>
    list!.map((a) => (revisions[a.id] ? { ...a, metaRevisions: revisions[a.id] } : a)),
  )

const agentsOf = (qc: QueryClient) => qc.getQueryData<Agent[]>(agentsKey)!
const agentIn = (qc: QueryClient, id: string) => agentsOf(qc).find((a) => a.id === id)!
const meta = (qc: QueryClient, id: string) => agentIn(qc, id).botMeta
const listOf = (qc: QueryClient) => sectionsOf(agentsOf(qc))
/** Who sits where, by section id ('' for none). */
const seating = (qc: QueryClient) => Object.fromEntries(agentsOf(qc).map((a) => [a.id, sectionOf(a) ?? '']))

const expecting = (key: string, revision?: number) =>
  revision === undefined ? {} : { ui_meta_expected_revisions: { [key]: revision } }
/** The write of an agent's Bot Mode record. */
const botsWrite = (name: string, botMeta: Record<string, unknown>, revision?: number) => [
  'profiles.configure',
  { name, ui_meta: { 'hermes-bots': botMeta }, ...expecting('hermes-bots', revision) },
]
/** The write of the list, on the main agent. */
const listWrite = (sections: Section[], revision?: number) => [
  'profiles.configure',
  { name: 'default', ui_meta: { 'murmur-sections': sections }, ...expecting('murmur-sections', revision) },
]

/** Hermes's answers a test is holding. */
const held: (() => void)[] = []

afterEach(async () => {
  // Every write still on its way lands (each record's writes queue, one at a time), so none spills into the next test.
  for (let i = 0; i < 20; i++) {
    held.splice(0).forEach((answer) => answer())
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
})

/** Holds Hermes's answers, so a test can look at the roster before it answers. */
function holdHermes() {
  rpc.mockImplementation(() => new Promise((resolve) => held.push(() => resolve(saved()))))
  return {
    /** Once `n` writes are waiting on Hermes. */
    asked: (n: number) => vi.waitFor(() => expect(held).toHaveLength(n)),
    answer: () => held.splice(0).forEach((r) => r()),
  }
}

describe('the list of sections', () => {
  it('is Murmur’s own list, tidied: trimmed, each id once, and only sections with both an id and a name', () => {
    const list = [
      { id: ' work ', name: ' Work ', groups: ['g1', 2, null, 'g2'] },
      { id: 'nameless', name: '  ' },
      { name: 'No id' },
      { id: 7, name: 'Not an id' },
      { id: 'work', name: 'Work again', groups: ['g3'] },
      null,
      'stray',
      { id: 'home', name: 'Home', groups: 'g4' },
    ]
    expect(sectionsOf([mainAgent(list)])).toEqual([
      { id: 'work', name: 'Work', groups: ['g1', 'g2'] },
      { id: 'home', name: 'Home', groups: [] },
    ])
  })

  it('is read from the main agent only, and is empty when it holds no list', () => {
    expect(sectionsOf([agent('default', { isDefault: true }), agent('atlas', { sectionsMeta: [work] })])).toEqual([])
    expect(sectionsOf([mainAgent({ work })])).toEqual([])
  })

  it('ends with the sections only an agent knows about, as Hermes Desktop made them, in roster order', () => {
    const agents = [
      mainAgent([work]),
      agent('atlas', { botMeta: { sectionId: 'later', sectionName: 'Later' } }),
      agent('echo', { botMeta: { sectionId: ' desk ', sectionName: ' On the desk ' } }),
      // The first name an agent gives a section is the one it goes by.
      agent('pip', { botMeta: { sectionId: 'later', sectionName: 'Another name' } }),
    ]
    expect(sectionsOf(agents)).toEqual([
      work,
      { id: 'later', name: 'Later', groups: [], adopted: true },
      { id: 'desk', name: 'On the desk', groups: [], adopted: true },
    ])
  })

  it('lets go of one made in Hermes Desktop once nothing is on it, as when it was deleted there', () => {
    const desk = { id: 'desk', name: 'Desk', groups: [], adopted: true as const }
    const shelf = { ...desk, id: 'shelf', name: 'Shelf', groups: ['g3'] }
    const list = [work, desk, shelf, { ...side, groups: [] }]
    // Desk had Nova on it; now nobody. Shelf keeps a group of Murmur's, and Side is Murmur's own: both stay.
    expect(sectionsOf([mainAgent(list), agent('nova', { botMeta: at(desk) })])).toEqual(list)
    expect(sectionsOf([mainAgent(list), agent('nova', { botMeta: at(null) })])).toEqual([
      work,
      shelf,
      { ...side, groups: [] },
    ])
  })

  it('gains nothing from an agent with a section id but no name', () => {
    const agents = [
      agent('atlas', { botMeta: { sectionId: 'x' } }),
      agent('echo', { botMeta: { sectionId: 'y', sectionName: '  ' } }),
      agent('pip', { botMeta: { sectionId: 'z', sectionName: 5 } }),
    ]
    expect(sectionsOf(agents)).toEqual([])
  })

  it('is empty before the roster has loaded', () => {
    expect(sectionsOf(undefined)).toEqual([])
    expect(sectionsOf([])).toEqual([])
  })

  it('takes the name its members all carry, as when it was renamed in Hermes Desktop', () => {
    const agents = [
      mainAgent([work, home]),
      agent('atlas', { botMeta: { ...at(work), sectionName: 'Job' } }),
      agent('echo', { botMeta: { ...at(work), sectionName: ' Job ' } }),
      // A member without a name has no say.
      agent('pip', { botMeta: { sectionId: 'work' } }),
      agent('scout', { botMeta: at(home) }),
    ]
    expect(sectionsOf(agents)).toEqual([{ ...work, name: 'Job' }, home])
  })

  it('keeps the list’s name while its members disagree, as while a rename is still landing', () => {
    const on = (...names: string[]) =>
      sectionsOf([
        mainAgent([work]),
        ...names.map((n, i) => agent(`a${i}`, { botMeta: { ...at(work), sectionName: n } })),
      ])[0].name
    expect(on('Job', 'Work')).toBe('Work')
    expect(on('Job', 'Office')).toBe('Work')
    expect(on('Job', 'Job')).toBe('Job')
  })
})

describe('where an agent sits', () => {
  it('is the section id it carries, trimmed, or nowhere', () => {
    expect(sectionOf(agent('atlas', { botMeta: { sectionId: ' work ', sectionName: 'Work' } }))).toBe('work')
    // A name alone doesn't place it.
    expect(sectionOf(agent('atlas', { botMeta: { sectionName: 'Work' } }))).toBeUndefined()
    for (const sectionId of [null, '', '   ', 7])
      expect(sectionOf(agent('atlas', { botMeta: { sectionId } }))).toBeUndefined()
    expect(sectionOf(agent('atlas'))).toBeUndefined()
  })
})

describe('filing on a section', () => {
  it('moves the agents not already there at once, sending each one’s whole Bot Mode record', async () => {
    const qc = roster()
    const hermes = holdHermes()
    const done = file(qc, { agents: ['atlas', 'scout', 'pip'] }, work)
    await hermes.asked(2)
    // Before Hermes answers.
    expect(seating(qc)).toEqual({ default: '', atlas: 'work', echo: 'work', pip: 'work', scout: 'work' })
    expect(meta(qc, 'scout')).toEqual({ title: 'Scout', color: '#4f8', ...at(work) })
    hermes.answer()
    await done
    expect(rpc.mock.calls).toEqual([
      botsWrite('pip', { title: 'Pip', ...at(work) }),
      botsWrite('scout', { title: 'Scout', color: '#4f8', ...at(work) }),
    ])
  })

  it('re-stamps an agent that’s there under another name', async () => {
    const qc = roster([work, home], [agent('atlas', { botMeta: { title: 'Atlas', ...at(work), sectionName: 'Old' } })])
    await file(qc, { agents: ['atlas', 'echo'] }, work)
    expect(rpc.mock.calls).toEqual([botsWrite('atlas', { title: 'Atlas', ...at(work) })])
  })

  it('takes agents off any section with null, clearing both fields', async () => {
    const qc = roster()
    await file(qc, { agents: ['atlas', 'pip', 'scout'] }, null)
    expect(seating(qc)).toEqual({ default: '', atlas: '', echo: 'work', pip: '', scout: '' })
    expect(rpc.mock.calls).toEqual([
      botsWrite('atlas', { title: 'Atlas', avatar: 'owl', sectionId: null, sectionName: null }),
      botsWrite('pip', { title: 'Pip', sectionId: null, sectionName: null }),
    ])
  })

  it('moves a group from one section to another, so it never sits on two', async () => {
    const qc = roster()
    await file(qc, { groups: ['g1'] }, home)
    const moved = [
      { ...work, groups: [] },
      { ...home, groups: ['g2', 'g1'] },
    ]
    expect(listOf(qc)).toEqual(moved)
    expect(rpc.mock.calls).toEqual([listWrite(moved)])
    // Filed again where it is, it isn't doubled; with null it leaves every section.
    await file(qc, { groups: ['g1'] }, home)
    expect(listOf(qc)[1].groups).toEqual(['g2', 'g1'])
    await file(qc, { groups: ['g1', 'g2'] }, null)
    expect(rpc).toHaveBeenLastCalledWith(
      ...listWrite([
        { ...work, groups: [] },
        { ...home, groups: [] },
      ]),
    )
  })

  it('writes the main agent’s place and the list as two records, leaving its own record alone', async () => {
    const qc = roster()
    await file(qc, { agents: ['default'], groups: ['g2'] }, work)
    const list = [
      { ...work, groups: ['g1', 'g2'] },
      { ...home, groups: [] },
    ]
    expect(rpc.mock.calls).toEqual([botsWrite('default', { title: 'Hermes', ...at(work) }), listWrite(list)])
    expect(agentIn(qc, 'default')).toMatchObject({
      botMeta: { title: 'Hermes', ...at(work) },
      sectionsMeta: list,
      murmurMeta: { hue: 210 },
    })
  })

  it('writes nothing when nothing moves', async () => {
    const qc = roster()
    await file(qc, { agents: ['atlas', 'echo', 'nobody'] }, work)
    await file(qc, { agents: ['scout'] }, null)
    await file(qc, {}, home)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('a new section', () => {
  it('goes at the end of the list with a fresh id, with what was picked filed on it', async () => {
    const qc = roster()
    const hermes = holdHermes()
    const done = createSection(qc, '  Research  ', { agents: ['scout', 'atlas'], groups: ['g2'] })
    await hermes.asked(3)
    // It shows at once, with its group and its agents.
    const made = listOf(qc)[2]
    expect(listOf(qc)).toEqual([work, { ...home, groups: [] }, { id: made.id, name: 'Research', groups: ['g2'] }])
    expect(seating(qc)).toEqual({ default: '', atlas: made.id, echo: 'work', pip: 'home', scout: made.id })
    hermes.answer()
    const section = await done
    expect(section).toEqual({ id: made.id, name: 'Research', groups: [] })
    expect(section.id).toMatch(/^sec-/)
    expect([work.id, home.id]).not.toContain(section.id)
    expect(rpc.mock.calls).toEqual([
      listWrite([work, { ...home, groups: [] }, { ...section, groups: ['g2'] }]),
      botsWrite('atlas', { title: 'Atlas', avatar: 'owl', ...at(section) }),
      botsWrite('scout', { title: 'Scout', color: '#4f8', ...at(section) }),
    ])
  })

  it('gets an id of its own every time', async () => {
    const qc = roster()
    const a = await createSection(qc, 'A', { agents: [], groups: [] })
    const b = await createSection(qc, 'B', { agents: [], groups: [] })
    expect(a.id).not.toBe(b.id)
    expect(listOf(qc).map((s) => s.name)).toEqual(['Work', 'Home', 'A', 'B'])
  })
})

describe('editing a section', () => {
  it('renames it, re-stamping the name on everyone in it, with one write of the list', async () => {
    const qc = roster()
    const hermes = holdHermes()
    const done = editSection(qc, 'work', ' Office ', { agents: ['atlas', 'echo'], groups: ['g1'] })
    await hermes.asked(3)
    const office = { ...work, name: 'Office' }
    expect(listOf(qc)).toEqual([office, home])
    expect(meta(qc, 'echo')).toEqual({ title: 'Echo', ...at(office) })
    hermes.answer()
    await done
    expect(rpc.mock.calls).toEqual([
      listWrite([office, home]),
      botsWrite('atlas', { title: 'Atlas', avatar: 'owl', ...at(office) }),
      botsWrite('echo', { title: 'Echo', ...at(office) }),
    ])
  })

  it('sends anyone left out back to no section, and takes in whoever was added from elsewhere', async () => {
    const qc = roster()
    await editSection(qc, 'work', 'Work', { agents: ['echo', 'pip', 'scout'], groups: ['g1'] })
    expect(seating(qc)).toEqual({ default: '', atlas: '', echo: 'work', pip: 'work', scout: 'work' })
    // Echo is there under that name already.
    expect(rpc.mock.calls).toEqual([
      listWrite([work, home]),
      botsWrite('atlas', { title: 'Atlas', avatar: 'owl', sectionId: null, sectionName: null }),
      botsWrite('pip', { title: 'Pip', ...at(work) }),
      botsWrite('scout', { title: 'Scout', color: '#4f8', ...at(work) }),
    ])
  })

  it('moves the groups listed onto it, out of any other section, and lets go of the rest', async () => {
    const qc = roster()
    await editSection(qc, 'home', 'Home', { agents: ['pip'], groups: ['g1', 'g5'] })
    // g2 goes back to no section.
    const list = [
      { ...work, groups: [] },
      { ...home, groups: ['g1', 'g5'] },
    ]
    expect(listOf(qc)).toEqual(list)
    expect(rpc.mock.calls).toEqual([listWrite(list)])
  })
})

describe('moving a section', () => {
  it('goes up or down one place', async () => {
    const qc = roster([work, home, side])
    const hermes = holdHermes()
    const done = moveSection(qc, 'side', -1)
    await hermes.asked(1)
    expect(listOf(qc).map((s) => s.id)).toEqual(['work', 'side', 'home'])
    hermes.answer()
    await done
    rpc.mockResolvedValue(saved())
    await moveSection(qc, 'work', 1)
    expect(rpc.mock.calls).toEqual([listWrite([work, side, home]), listWrite([side, work, home])])
  })

  it('writes nothing at either end, or for a section that isn’t there', async () => {
    const qc = roster()
    await moveSection(qc, 'work', -1)
    await moveSection(qc, 'home', 1)
    await moveSection(qc, 'gone', 1)
    expect(rpc).not.toHaveBeenCalled()
    expect(listOf(qc).map((s) => s.id)).toEqual(['work', 'home'])
  })

  it('can move a section made in Hermes Desktop, which then joins Murmur’s list', async () => {
    const qc = roster([work, home], [agent('nova', { botMeta: { sectionId: 'desk', sectionName: 'Desk' } })])
    await moveSection(qc, 'desk', -1)
    // Still Hermes Desktop's: kept while Nova is on it.
    expect(rpc.mock.calls).toEqual([listWrite([work, { id: 'desk', name: 'Desk', groups: [], adopted: true }, home])])
  })
})

describe('deleting a section', () => {
  const nova = agent('nova', { botMeta: { title: 'Nova', ...at(home) } })

  it('takes everyone out and removes it, and the undo puts it back where it was with the same members', async () => {
    const qc = roster([work, home, side], [nova])
    const undo = await deleteSection(qc, 'home')
    expect(listOf(qc)).toEqual([work, side])
    expect(seating(qc)).toEqual({ default: '', atlas: 'work', echo: 'work', pip: '', scout: '', nova: '' })
    expect(rpc.mock.calls).toEqual([
      botsWrite('pip', { title: 'Pip', sectionId: null, sectionName: null }),
      botsWrite('nova', { title: 'Nova', sectionId: null, sectionName: null }),
      listWrite([work, side]),
    ])
    rpc.mockClear()
    await undo()
    expect(listOf(qc)).toEqual([work, home, side])
    expect(seating(qc)).toEqual({ default: '', atlas: 'work', echo: 'work', pip: 'home', scout: '', nova: 'home' })
    expect(rpc.mock.calls).toEqual([
      listWrite([work, home, side]),
      botsWrite('pip', { title: 'Pip', ...at(home) }),
      botsWrite('nova', { title: 'Nova', ...at(home) }),
    ])
  })

  it('comes back at the end when the list has got shorter since', async () => {
    const qc = roster([work, home, side])
    const undo = await deleteSection(qc, 'side')
    await deleteSection(qc, 'work')
    await undo()
    expect(listOf(qc).map((s) => s.id)).toEqual(['home', 'side'])
  })

  it('does nothing for a section that isn’t there, and neither does its undo', async () => {
    const qc = roster()
    const undo = await deleteSection(qc, 'gone')
    await undo()
    expect(rpc).not.toHaveBeenCalled()
    expect(listOf(qc)).toEqual([work, home])
  })

  it('never leaves a group on two sections, even one filed elsewhere before the undo', async () => {
    const qc = roster([work, home, side])
    const undo = await deleteSection(qc, 'home')
    await file(qc, { groups: ['g2'] }, side)
    await undo()
    expect(listOf(qc).filter((s) => s.groups?.includes('g2'))).toHaveLength(1)
  })

  it('puts back only the agents that haven’t been filed elsewhere since', async () => {
    const qc = roster([work, home, side], [nova])
    const undo = await deleteSection(qc, 'home')
    await file(qc, { agents: ['pip'] }, side)
    rpc.mockClear()
    await undo()
    expect(seating(qc)).toMatchObject({ pip: 'side', nova: 'home' })
    expect(rpc.mock.calls).toEqual([listWrite([work, home, side]), botsWrite('nova', { title: 'Nova', ...at(home) })])
  })

  it('forgets that it was folded, and its undo folds it again', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    const folded = () => JSON.parse(store.get('murmur:sections-folded') ?? '{}')
    const { setFolded } = await import('./sections')
    const qc = roster()
    setFolded('home', true)
    const undo = await deleteSection(qc, 'home')
    expect(folded()).toEqual({})
    await undo()
    expect(folded()).toEqual({ home: true })
    setFolded('home', false)
    vi.unstubAllGlobals()
  })
})

describe('writing to Hermes', () => {
  it('sends one write at a time per record, each made on top of the one before', async () => {
    const qc = roster([work, home, side])
    revise(qc, { default: { 'murmur-sections': 3 } })
    const hermes = holdHermes()
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => held.push(() => resolve(saved({ 'murmur-sections': 4 + rpc.mock.calls.length - 1 })))),
    )
    // Two quick drags of groups: both show at once, and the second waits for the first.
    const one = file(qc, { groups: ['g1'] }, side)
    const two = file(qc, { groups: ['g2'] }, side)
    await hermes.asked(1)
    expect(listOf(qc).find((s) => s.id === 'side')?.groups).toEqual(['g1', 'g2'])
    hermes.answer()
    await hermes.asked(1)
    hermes.answer()
    await Promise.all([one, two])
    // Each is made from the list as it stands when its turn comes, so neither undoes the other.
    const list = [
      { ...work, groups: [] },
      { ...home, groups: [] },
      { ...side, groups: ['g1', 'g2'] },
    ]
    expect(rpc.mock.calls).toEqual([listWrite(list, 3), listWrite(list, 4)])
  })

  it('keeps a name given in Hermes Desktop when Murmur takes the last agents out', async () => {
    // Renamed Job in Desktop: only its members say so.
    const qc = roster(
      [work, home],
      [
        agent('atlas', { botMeta: { ...at(work), sectionName: 'Job' } }),
        agent('echo', { botMeta: { ...at(work), sectionName: 'Job' } }),
      ],
    )
    await file(qc, { agents: ['atlas', 'echo'] }, null)
    expect(listOf(qc)[0]).toEqual({ ...work, name: 'Job' })
  })

  it('asks Hermes to take each write only over the revision Murmur read', async () => {
    const qc = roster()
    revise(qc, { default: { 'hermes-bots': 2, 'murmur-sections': 7 }, pip: { murmur: 1 }, scout: { 'hermes-bots': 4 } })
    await file(qc, { agents: ['pip', 'scout'], groups: ['g2'] }, work)
    expect(rpc.mock.calls).toEqual([
      // A record Hermes has never written is at revision 0.
      botsWrite('pip', { title: 'Pip', ...at(work) }, 0),
      botsWrite('scout', { title: 'Scout', color: '#4f8', ...at(work) }, 4),
      listWrite(
        [
          { ...work, groups: ['g1', 'g2'] },
          { ...home, groups: [] },
        ],
        7,
      ),
    ])
  })

  it('sends no revisions to a Hermes too old to keep them', async () => {
    const qc = roster()
    await file(qc, { agents: ['scout'], groups: ['g2'] }, work)
    expect(rpc).toHaveBeenCalledTimes(2)
    for (const [, params] of rpc.mock.calls) expect(params).not.toHaveProperty('ui_meta_expected_revisions')
  })

  it('keeps the revision Hermes gives back, for the next write', async () => {
    const qc = roster()
    revise(qc, { scout: { 'hermes-bots': 4, murmur: 9 } })
    rpc.mockResolvedValueOnce(saved({ 'hermes-bots': 5 }))
    await file(qc, { agents: ['scout'] }, work)
    expect(agentIn(qc, 'scout').metaRevisions).toEqual({ 'hermes-bots': 5, murmur: 9 })
    // An answer without one leaves it as it was.
    await file(qc, { agents: ['scout'] }, home)
    expect(rpc).toHaveBeenLastCalledWith(...botsWrite('scout', { title: 'Scout', color: '#4f8', ...at(home) }, 5))
    expect(agentIn(qc, 'scout').metaRevisions).toEqual({ 'hermes-bots': 5, murmur: 9 })
  })

  it('reads an agent again when Hermes Desktop wrote it in between, and makes the change on top', async () => {
    const qc = roster()
    revise(qc, { scout: { 'hermes-bots': 4 } })
    const scout: Profile = {
      name: 'scout',
      is_default: false,
      ui_meta: { 'hermes-bots': { title: 'Scout', color: '#4f8', pinned: true } },
      ui_meta_revisions: { 'hermes-bots': 5 },
    }
    listProfiles.mockResolvedValue([{ name: 'default', is_default: true }, scout])
    rpc.mockResolvedValueOnce(conflict('hermes-bots')).mockResolvedValueOnce(saved({ 'hermes-bots': 6 }))
    await file(qc, { agents: ['scout'] }, work)
    expect(listProfiles).toHaveBeenCalledExactlyOnceWith({ include_sessions: false })
    expect(rpc.mock.calls).toEqual([
      botsWrite('scout', { title: 'Scout', color: '#4f8', ...at(work) }, 4),
      botsWrite('scout', { title: 'Scout', color: '#4f8', pinned: true, ...at(work) }, 5),
    ])
    expect(meta(qc, 'scout')).toEqual({ title: 'Scout', color: '#4f8', pinned: true, ...at(work) })
    expect(agentIn(qc, 'scout').metaRevisions).toEqual({ 'hermes-bots': 6 })
  })

  it('moves a section on top of a list changed on another device', async () => {
    const qc = roster([work, home, side])
    revise(qc, { default: { 'murmur-sections': 7 } })
    const news = { id: 'news', name: 'News', groups: [] }
    listProfiles.mockResolvedValue([
      {
        name: 'default',
        is_default: true,
        ui_meta: { 'hermes-bots': { title: 'Hermes' }, 'murmur-sections': [news, work, home, side] },
        ui_meta_revisions: { 'murmur-sections': 8 },
      },
    ])
    rpc.mockResolvedValueOnce(conflict('murmur-sections')).mockResolvedValueOnce(saved({ 'murmur-sections': 9 }))
    await moveSection(qc, 'side', -1)
    expect(rpc.mock.calls).toEqual([listWrite([work, side, home], 7), listWrite([news, work, side, home], 8)])
    expect(listOf(qc)).toEqual([news, work, side, home])
    expect(agentIn(qc, 'default').metaRevisions).toEqual({ 'murmur-sections': 9 })
  })

  it('gives up after three tries when the record keeps changing', async () => {
    const qc = roster()
    revise(qc, { scout: { 'hermes-bots': 4 } })
    listProfiles.mockResolvedValue([{ name: 'scout', is_default: false, ui_meta_revisions: { 'hermes-bots': 5 } }])
    rpc.mockResolvedValue(conflict('hermes-bots'))
    await expect(file(qc, { agents: ['scout'] }, work)).rejects.toThrow('Hermes didn’t save the change.')
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(listProfiles).toHaveBeenCalledTimes(2)
  })

  it('stops at once when Hermes turns a write down for another reason', async () => {
    const qc = roster()
    rpc.mockResolvedValue({ ok: false, applied: { ui_meta: false } })
    await expect(file(qc, { agents: ['scout'] }, work)).rejects.toThrow('Hermes didn’t save the change.')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(listProfiles).not.toHaveBeenCalled()
  })
})

describe('changes made from the roster', () => {
  it('read the roster again from Hermes when done, the undo and a failed change included', async () => {
    const qc = roster([work, home, side])
    const refresh = vi.spyOn(qc, 'invalidateQueries')
    let writes!: ReturnType<typeof useSectionWrites>
    const Probe = () => {
      writes = useSectionWrites()
      return null
    }
    renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)))
    const undo = await writes.remove('home')
    expect(refresh).toHaveBeenCalledTimes(1)
    await undo()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(listOf(qc).map((s) => s.id)).toEqual(['work', 'home', 'side'])
    rpc.mockRejectedValue(new Error('offline'))
    await expect(writes.move('home', -1)).rejects.toThrow('offline')
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(refresh).toHaveBeenLastCalledWith({ queryKey: agentsKey })
  })
})

describe('folded sections', () => {
  const KEY = 'murmur:sections-folded'
  /** A browser's storage, as a map. */
  const storage = (store = new Map<string, string>()) => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    return store
  }
  /** The module as a fresh page load sees it. */
  const reload = async () => {
    vi.resetModules()
    return import('./sections')
  }
  /** What the hooks give on a first render. */
  const read = ({ useFolded, useFoldedMap }: Awaited<ReturnType<typeof reload>>) => {
    let seen: unknown
    const Probe = () => {
      seen = { work: useFolded('work'), home: useFolded('home'), side: useFolded('side'), all: useFoldedMap() }
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    return seen
  }

  afterEach(() => vi.unstubAllGlobals())

  it('are remembered on this device', async () => {
    const store = storage()
    const { setFolded } = await reload()
    setFolded('work', true)
    setFolded('home', true)
    setFolded('work', false)
    // Only what's folded: an unfolded or deleted section leaves nothing behind.
    expect(JSON.parse(store.get(KEY)!)).toEqual({ home: true })
  })

  it('are read back on the next visit', async () => {
    const store = storage()
    ;(await reload()).setFolded('work', true)
    expect(read(await reload())).toEqual({ work: true, home: false, side: false, all: { work: true } })
    // Whatever can't be read starts unfolded.
    store.set(KEY, '{not json')
    expect(read(await reload())).toEqual({ work: false, home: false, side: false, all: {} })
  })

  it('last the visit when the browser won’t keep them (private mode)', async () => {
    const refuse = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse })
    const sections = await reload()
    expect(read(sections)).toEqual({ work: false, home: false, side: false, all: {} })
    expect(() => sections.setFolded('work', true)).not.toThrow()
    // Once storage works again, the fold from before is in what's written.
    const store = storage()
    sections.setFolded('home', true)
    expect(JSON.parse(store.get(KEY)!)).toEqual({ work: true, home: true })
  })
})
