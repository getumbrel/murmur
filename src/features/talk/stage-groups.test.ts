import { describe, expect, it } from 'vitest'
import type { Find } from '@/features/umbrel/finds'
import { groups, hasPhotos, stepsTitle } from './stage-groups'
import type { StageItem, Step } from './talk'

const photos = (over: Partial<Extract<Find, { kind: 'photos' }>> = {}): StageItem => ({
  key: 'f:p',
  kind: 'find',
  find: { key: 'p', kind: 'photos', server: 'umbrel', query: 'beach', filters: [], photos: [{ id: '1' }, { id: '2' }], files: [], looked: [], ...over } as Find,
})
const step = (where: string): Step => ({ id: where, label: 'Did it', done: true, failed: false, where })
const steps = (...where: string[]): StageItem => ({ key: 'steps', kind: 'steps', steps: where.map(step) })
const file = { path: '/Home/a.pdf', name: 'a.pdf' }

describe('what shows on the stage', () => {
  it('counts every photo there is, not just the ones that came back', () => {
    expect(groups([photos({ total: 42 })])[0].label).toBe('42 photos')
  })

  it('leaves out what the agent did on the Umbrel when what it found is showing', () => {
    expect(groups([steps('your Umbrel'), photos()]).map((g) => g.label)).toEqual(['2 photos'])
  })

  it('keeps what it did elsewhere, under a name that reads as one', () => {
    const shown = groups([steps('your Umbrel', 'Home Assistant'), photos()])
    expect(shown.map((g) => g.label)).toEqual(['Home Assistant', '2 photos'])
    expect(shown[0].items[0]).toMatchObject({ steps: [{ where: 'Home Assistant' }] })
  })

  it('gives the Umbrel a capital where it stands alone', () => {
    expect(groups([steps('your Umbrel')]).map((g) => g.label)).toEqual(['Your Umbrel'])
    expect(stepsTitle([step('your Umbrel')])).toBe('Your Umbrel')
    expect(stepsTitle([step('A'), step('B')])).toBe('Done for you')
  })

  it('splits a search that found both, with the photos in front', () => {
    const shown = groups([photos({ files: [file] })])
    expect(shown.map((g) => g.label)).toEqual(['1 file', '2 photos'])
    expect(shown.at(-1)!.items[0]).toMatchObject({ find: { files: [] } })
    expect(shown[0].items[0]).toMatchObject({ find: { photos: [] } })
  })

  it('makes one gallery of the pictures a reply delivered', () => {
    const shown = groups([
      { key: 'm:a', kind: 'media', path: '/a.jpg' },
      { key: 'm:b', kind: 'media', path: '/b.png' },
      { key: 'm:c', kind: 'media', path: '/c.pdf' },
    ])
    expect(shown.map((g) => g.label)).toEqual(['2 photos', 'c.pdf'])
    expect(shown[0].gallery).toBe(true)
  })

  it('knows which finds are photos', () => {
    expect(hasPhotos(photos())).toBe(true)
    expect(hasPhotos(photos({ photos: [], pending: true }))).toBe(true)
    expect(hasPhotos(photos({ photos: [], files: [file] }))).toBe(false)
    expect(hasPhotos(photos({ photos: [] }))).toBe(false)
  })
})
