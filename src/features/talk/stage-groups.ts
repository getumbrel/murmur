import { serverName } from '@/features/chat/tool-labels'
import { mediaKind } from '@/features/media/files'
import { count, findLabel, sentence } from '@/features/umbrel/finds'
import { machineName } from '@/features/machine/shots'
import type { StageItem, Step } from './talk'

export type Group = { key: string; label: string; items: StageItem[]; gallery: boolean }

const UMBREL = serverName('umbrel')

const nameOf = (path: string) => path.split('/').pop() ?? path

/** Where the steps happened: one app by name, or several. */
export const stepsTitle = (steps: Step[]) => {
  const where = [...new Set(steps.map((s) => s.where).filter(Boolean))]
  return where.length === 1 ? sentence(where[0]!) : 'Done for you'
}

/** A search's photos get the stage's photo view; one that turned up only files stays a card. */
export const hasPhotos = (it: StageItem) =>
  it.kind === 'find' && it.find.kind === 'photos' && (it.find.photos.length > 0 || (!!it.find.pending && !it.find.files.length))

/**
 * What's on the stage, newest last, each with its chip. Photos the reply
 * delivered come as one gallery; a search that found photos and files is both,
 * photos in front. How the agent went about finding something on the Umbrel
 * doesn't get a place beside the thing it found.
 */
export function groups(items: StageItem[]): Group[] {
  const photos = items.filter((i) => i.kind === 'media' && mediaKind(i.path) === 'image')
  const found = items.some((i) => i.kind === 'find')
  const out: Group[] = []
  for (const it of items) {
    if (photos.includes(it)) {
      if (it === photos[0]) out.push({ key: 'photos', label: photos.length > 1 ? count(photos.length, 'photo') : 'Photo', items: photos, gallery: true })
      continue
    }
    if (it.kind === 'steps') {
      const steps = found ? it.steps.filter((s) => s.where !== UMBREL) : it.steps
      if (steps.length) out.push({ key: it.key, label: stepsTitle(steps), items: [{ ...it, steps }], gallery: false })
      continue
    }
    if (it.kind === 'find' && it.find.kind === 'photos' && hasPhotos(it) && it.find.files.length) {
      const { find } = it
      out.push({ key: `${it.key}:files`, label: findLabel({ ...find, photos: [] }), items: [{ ...it, find: { ...find, photos: [] } }], gallery: false })
      out.push({ key: it.key, label: findLabel({ ...find, files: [] }), items: [{ ...it, find: { ...find, files: [] } }], gallery: false })
      continue
    }
    const label =
      it.kind === 'media'
        ? nameOf(it.path)
        : it.kind === 'find'
          ? findLabel(it.find)
          : it.kind === 'approval'
            ? 'Your OK'
            : it.kind === 'browser'
              ? it.ask
                ? 'Needs a hand'
                : (it.site ?? 'Browser')
              : it.kind === 'machine'
                ? machineName(it.screen.machine)
                : 'View'
    out.push({ key: it.key, label, items: [it], gallery: false })
  }
  return out
}
