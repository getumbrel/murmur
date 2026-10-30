// Sections are shelves agents are filed on (src/state/sections.ts). Where an
// agent sits is written on the agent, where Hermes Desktop's Bot Mode keeps its
// own sections (ui_meta['hermes-bots'].sectionId and .sectionName); the list
// and its order, on the main agent (ui_meta['murmur-sections']). Murmur's own
// createSection, file, editSection, deleteSection and updateAgent run here
// against Hermes, and what they leave on each agent is read back from it,
// including when Hermes Desktop wrote the same record after Murmur read it.

import { QueryClient } from '@tanstack/react-query'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { listProfiles } from '@/hermes/compat'
import { agentsKey, toAgent, updateAgent, type Agent, type Profile } from '@/state/agents'
import { createSection, deleteSection, editSection, file, sectionOf, sectionsOf, type Section } from '@/state/sections'
import { agentName, api, connect, type Socket } from './client'

type Meta = Record<string, unknown>

let socket: Socket
let main: string
const qc = new QueryClient()
const shelfA = agentName('shelf-a')
const shelfB = agentName('shelf-b')
const desk = agentName('desk')
const made: string[] = []
// A group is filed by its room id; Murmur only keeps the id.
const room = `murmur-contract-room-${Date.now().toString(36)}`
// The main agent's records this file writes, as they were, to put back (null: there was none).
let mainBefore: Meta = {}
// What else Murmur keeps on the main agent, which section writes must leave alone.
let mainMurmur: { json: string; revision: number }
let shelf: Section
let deskSection: Section

const profiles = () => listProfiles<Profile>({ include_sessions: true })
const profile = async (agent: string) => (await profiles()).find((p) => p.name === agent)!
const metaOf = async (agent: string) => ((await profile(agent)).ui_meta ?? {}) as Meta
const botsOf = async (agent: string) => (await metaOf(agent))['hermes-bots'] as Meta
const revisionOf = async (agent: string, key: string) => (await profile(agent)).ui_meta_revisions?.[key] ?? 0
/** Read the agents from Hermes into the query the app's roster reads (useAgents). */
const refresh = async () =>
  void qc.setQueryData<Agent[]>(
    agentsKey,
    (await profiles()).map((p) => toAgent(p)),
  )
const held = () => qc.getQueryData<Agent[]>(agentsKey)
const heldAgent = (id: string) => held()!.find((a) => a.id === id)!
/** A write the way Hermes Desktop makes one: straight to Hermes, the whole record, unchecked. */
const desktopWrites = (agent: string, bots: Meta) =>
  socket.request('profiles.configure', { name: agent, ui_meta: { 'hermes-bots': bots } })

beforeAll(async () => {
  startGateway()
  socket = await connect()
  main = (await profiles()).find((p) => p.is_default)!.name
  const meta = await metaOf(main)
  mainBefore = Object.fromEntries(['murmur', 'murmur-sections'].map((key) => [key, meta[key] ?? null]))
  await socket.request('profiles.configure', {
    name: main,
    ui_meta: { murmur: { ...(meta.murmur as Meta), hue: 300 } },
  })
  mainMurmur = { json: JSON.stringify((await metaOf(main)).murmur), revision: await revisionOf(main, 'murmur') }
  for (const [id, name, hue] of [
    [shelfA, 'Shelf A', 210],
    [shelfB, 'Shelf B', 120],
    [desk, 'Desk', 30],
  ] as const) {
    await socket.request('profiles.create', { name: id, share_auth: true }, 120_000)
    made.push(id)
    // Murmur's look: its name and colour in hermes-bots, its hue in murmur.
    await updateAgent(toAgent(await profile(id)), { name, hue, role: 'Keeps things' })
  }
})
afterAll(async () => {
  for (const id of made) await api.call('DELETE', `/api/profiles/${id}`)
  if (main) await socket.request('profiles.configure', { name: main, ui_meta: mainBefore })
  socket?.close()
  stopGateway()
})

describe('a section', () => {
  it('is made with agents on it, which keep everything else Murmur and Hermes Desktop wrote on them', async () => {
    // Something Hermes Desktop's Bot Mode wrote, which filing must keep.
    await desktopWrites(shelfA, { ...(await botsOf(shelfA)), avatar: 'desktop' })
    const before = { [shelfA]: await metaOf(shelfA), [shelfB]: await metaOf(shelfB) }
    await refresh()
    shelf = await createSection(qc, '  Research ', { agents: [shelfA], groups: [room] })
    expect(shelf).toMatchObject({ id: expect.any(String), name: 'Research' })
    await refresh()
    await file(qc, { agents: [shelfB] }, shelf)

    for (const id of [shelfA, shelfB]) {
      const after = await metaOf(id)
      expect(after['hermes-bots']).toEqual({
        ...(before[id]['hermes-bots'] as Meta),
        sectionId: shelf.id,
        sectionName: 'Research',
      })
      expect(after.murmur).toEqual(before[id].murmur)
    }
    expect(await botsOf(shelfA)).toMatchObject({ avatar: 'desktop', title: 'Shelf A', imageKind: 'shape' })
    expect((await metaOf(shelfA)).murmur).toEqual({ hue: 210 })
    await refresh()
    expect([sectionOf(heldAgent(shelfA)), sectionOf(heldAgent(shelfB)), sectionOf(heldAgent(desk))]).toEqual([
      shelf.id,
      shelf.id,
      undefined,
    ])
  })

  it('is listed on the main agent, in a record of its own', async () => {
    const meta = await metaOf(main)
    expect(meta['murmur-sections']).toEqual([{ id: shelf.id, name: 'Research', groups: [room] }])
    // Never written by a section change: the same bytes, at the same revision.
    expect(JSON.stringify(meta.murmur)).toBe(mainMurmur.json)
    expect(await revisionOf(main, 'murmur')).toBe(mainMurmur.revision)
    await refresh()
    expect(sectionsOf(held())).toEqual([{ id: shelf.id, name: 'Research', groups: [room] }])
  })

  it('made in Hermes Desktop, which only its agents carry, joins the end of the list', async () => {
    deskSection = { id: crypto.randomUUID(), name: 'From Desktop' }
    await desktopWrites(desk, { ...(await botsOf(desk)), sectionId: deskSection.id, sectionName: deskSection.name })
    await refresh()
    expect(sectionsOf(held())).toEqual([
      { id: shelf.id, name: 'Research', groups: [room] },
      { ...deskSection, groups: [], adopted: true },
    ])
    expect(sectionOf(heldAgent(desk))).toBe(deskSection.id)
  })

  it('is renamed, and its agents carry the new name', async () => {
    await refresh()
    await editSection(qc, shelf.id, 'Reading', { agents: [shelfA, shelfB], groups: [room] })

    for (const id of [shelfA, shelfB])
      expect(await botsOf(id)).toMatchObject({ sectionId: shelf.id, sectionName: 'Reading' })
    expect(await botsOf(shelfA)).toMatchObject({ avatar: 'desktop', title: 'Shelf A' })
    expect((await metaOf(main))['murmur-sections']).toEqual([
      { id: shelf.id, name: 'Reading', groups: [room] },
      { ...deskSection, groups: [], adopted: true },
    ])
    await refresh()
    expect(sectionsOf(held())).toEqual([
      { id: shelf.id, name: 'Reading', groups: [room] },
      { ...deskSection, groups: [], adopted: true },
    ])
  })

  it('is deleted with its agents taken off it, and its undo puts them back', async () => {
    await refresh()
    const undo = await deleteSection(qc, shelf.id)

    // Hermes keeps a null inside a record as null (only a null record is removed), so Murmur reads null as "on no section".
    for (const id of [shelfA, shelfB]) {
      const bots = await botsOf(id)
      expect(bots).toHaveProperty('sectionId', null)
      expect(bots).toHaveProperty('sectionName', null)
    }
    expect(await botsOf(shelfA)).toMatchObject({ avatar: 'desktop', title: 'Shelf A' })
    expect((await metaOf(main))['murmur-sections']).toEqual([{ ...deskSection, groups: [], adopted: true }])
    await refresh()
    expect([sectionOf(heldAgent(shelfA)), sectionOf(heldAgent(shelfB))]).toEqual([undefined, undefined])
    expect(sectionsOf(held())).toEqual([{ ...deskSection, groups: [], adopted: true }])

    await undo()
    for (const id of [shelfA, shelfB])
      expect(await botsOf(id)).toMatchObject({ sectionId: shelf.id, sectionName: 'Reading' })
    expect(await botsOf(shelfA)).toMatchObject({ avatar: 'desktop', title: 'Shelf A' })
    await refresh()
    expect(sectionsOf(held())).toEqual([
      { id: shelf.id, name: 'Reading', groups: [room] },
      { ...deskSection, groups: [], adopted: true },
    ])
    expect(JSON.stringify((await metaOf(main)).murmur)).toBe(mainMurmur.json)
  })

  it('stays an agent’s when Murmur edits the agent', async () => {
    await refresh()
    await updateAgent(heldAgent(shelfA), { name: 'Shelf A II', hue: 40, role: 'Keeps more' })

    expect(await botsOf(shelfA)).toMatchObject({
      title: 'Shelf A II',
      sectionId: shelf.id,
      sectionName: 'Reading',
      avatar: 'desktop',
    })
    await refresh()
    expect(sectionOf(heldAgent(shelfA))).toBe(shelf.id)
  })
})

describe('a write made elsewhere after Murmur read the agents', () => {
  it('makes Hermes refuse a write from the older read, naming the record that moved', async () => {
    const revision = await revisionOf(shelfB, 'hermes-bots')
    const bots = await botsOf(shelfB)

    const stale = await socket.request('profiles.configure', {
      name: shelfB,
      ui_meta: { 'hermes-bots': { ...bots, sectionId: null } },
      ui_meta_expected_revisions: { 'hermes-bots': revision - 1 },
    })
    expect(stale).toEqual({
      ok: false,
      applied: {
        ui_meta: false,
        ui_meta_conflicts: { 'hermes-bots': { expected: revision - 1, actual: revision } },
        ui_meta_revisions: { 'hermes-bots': revision },
      },
    })
    expect(await botsOf(shelfB)).toEqual(bots)
    expect(await revisionOf(shelfB, 'hermes-bots')).toBe(revision)

    const fresh = await socket.request('profiles.configure', {
      name: shelfB,
      ui_meta: { 'hermes-bots': bots },
      ui_meta_expected_revisions: { 'hermes-bots': revision },
    })
    expect(fresh).toEqual({ ok: true, applied: { ui_meta: true, ui_meta_revisions: { 'hermes-bots': revision + 1 } } })
  })

  it('is kept when Murmur then files that agent', async () => {
    await refresh()
    const read = heldAgent(shelfB).metaRevisions!['hermes-bots']
    expect(read).toBe(await revisionOf(shelfB, 'hermes-bots'))
    // Hermes Desktop changes the agent after Murmur read it…
    await desktopWrites(shelfB, { ...(await botsOf(shelfB)), avatar: 'desktop-2' })
    // …and Murmur, still holding what it read, files it on the Desktop's section.
    await file(qc, { agents: [shelfB] }, sectionsOf(held()).find((s) => s.id === deskSection.id)!)

    expect(await botsOf(shelfB)).toMatchObject({
      avatar: 'desktop-2',
      title: 'Shelf B',
      sectionId: deskSection.id,
      sectionName: 'From Desktop',
    })
    // Hermes Desktop's write, then Murmur's once on top of it (the one from the older read was refused).
    expect(await revisionOf(shelfB, 'hermes-bots')).toBe(read + 2)
    expect(heldAgent(shelfB).metaRevisions!['hermes-bots']).toBe(read + 2)
  })

  it('is kept when Murmur then edits that agent', async () => {
    await refresh()
    // Hermes Desktop files the agent somewhere else after Murmur read it…
    await desktopWrites(shelfA, { ...(await botsOf(shelfA)), sectionId: deskSection.id, sectionName: deskSection.name })
    // …and Murmur, still holding what it read, renames it.
    await updateAgent(heldAgent(shelfA), { name: 'Shelf A III', hue: 40, role: 'Keeps more' })

    expect(await botsOf(shelfA)).toMatchObject({
      title: 'Shelf A III',
      sectionId: deskSection.id,
      sectionName: deskSection.name,
    })
  })

  it('to the list, is kept when Murmur then makes a section', async () => {
    await refresh()
    // Murmur on another device adds a section after this one read the list…
    const elsewhere = { id: `sec-elsewhere-${Date.now().toString(36)}`, name: 'Elsewhere', groups: [] }
    const list = (await metaOf(main))['murmur-sections'] as Section[]
    await socket.request('profiles.configure', { name: main, ui_meta: { 'murmur-sections': [...list, elsewhere] } })
    // …and this one, still holding what it read, makes another.
    const later = await createSection(qc, 'Later', { agents: [], groups: [] })

    expect((await metaOf(main))['murmur-sections']).toEqual([
      ...list,
      elsewhere,
      { id: later.id, name: 'Later', groups: [] },
    ])
    expect(JSON.stringify((await metaOf(main)).murmur)).toBe(mainMurmur.json)
  })
})

describe('a section made in Hermes Desktop', () => {
  it('goes once Hermes Desktop deletes it, though Murmur had listed it', async () => {
    // Desktop deletes a section by taking its bots off it.
    for (const agent of held()!.filter((a) => sectionOf(a) === deskSection.id))
      await desktopWrites(agent.id, { ...(await botsOf(agent.id)), sectionId: null, sectionName: null })
    await refresh()
    expect((await metaOf(main))['murmur-sections']).toContainEqual({ ...deskSection, groups: [], adopted: true })
    expect(sectionsOf(held()).map((s) => s.id)).not.toContain(deskSection.id)
  })
})
