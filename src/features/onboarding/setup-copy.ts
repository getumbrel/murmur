import { hexHue, hueFor } from '@/lib/hues'
import type { FoundAgent, FoundHermes } from '@/state/setup'

// The words behind "Where should your agents live?" and "Your agents are
// here", kept apart from the screens so they can be tested. Choosing which
// Hermes leads, and its count line, live with the setup answer (state/setup.ts).

const NBSP = ' '

/** Other agents than the main one, or someone has talked to it: "with your agents in it". */
export const hasAgentsOrChats = (f: FoundHermes) =>
  Math.max(f.agentCount ?? 0, f.agents?.length ?? 0) >= 2 || (f.chats ?? 0) > 0

/** Where it is, for a sentence: "this Umbrel", "this computer", "studio.local". */
export const placeOf = (f: Pick<FoundHermes, 'where' | 'host'>) =>
  f.where === 'umbrel' ? 'this Umbrel' : f.where === 'computer' ? 'this computer' : f.host.replace(/:\d+$/, '')

/** The line under "Where should your agents live?", by what's leading. */
export function whereBody(lead: FoundHermes | undefined) {
  if (!lead) return 'Right here in Murmur, or in a Hermes you already run.'
  const umbrel = lead.where === 'umbrel'
  const there = umbrel ? 'Hermes Agent is on this Umbrel' : `There’s a Hermes on ${placeOf(lead)}`
  if (lead.outdated) return `${there}, but it needs an update first.`
  if (lead.needsSignIn) return `${there}. Sign in to use it, or start fresh.`
  if (umbrel) {
    return hasAgentsOrChats(lead)
      ? 'Hermes Agent is already on this Umbrel, with your agents in it.'
      : 'Hermes Agent is already on this Umbrel. Use it, or start fresh.'
  }
  return hasAgentsOrChats(lead) ? `${there} with your agents in it.` : `${there}. Use it, or start fresh.`
}

/** When it can't be used as it is, the card says where it is and which Hermes: "On this Umbrel · Hermes 0.20.1". */
export function problemLine(f: FoundHermes) {
  return [f.where === 'umbrel' ? 'On this Umbrel' : f.host, f.version && `Hermes${NBSP}${f.version}`]
    .filter(Boolean)
    .join(' · ')
}

/** "Use Hermes Agent" for the Umbrel app; any other Hermes is "this Hermes". */
export const useLabel = (f: FoundHermes) => (f.where === 'umbrel' ? 'Use Hermes Agent' : 'Use this Hermes')

/** A found agent's colour: the one Murmur or Hermes Desktop gave it, else the one the app would pick. */
export function agentHue(a: FoundAgent) {
  return a.hue ?? hexHue(a.color) ?? (a.isDefault || a.id === 'default' ? 278 : hueFor(a.id))
}

/** "Your agents are here": who came along, main agent first. */
export function arrivedCopy(names: string[], total = names.length, chats = 0) {
  const n = Math.max(total, names.length, 1)
  const title = n === 1 ? 'Your agent is here' : 'Your agents are here'
  const who =
    n === 1
      ? (names[0] ?? 'Your agent')
      : n === 2
        ? `${names[0]} and ${names[1]}`
        : n === 3
          ? `${names[0]}, ${names[1]} and ${names[2]}`
          : `${names[0]}, ${names[1]} and ${n - 2}${NBSP}others`
  const body =
    chats > 0 ? `${who} came along, with all their chats.` : `${who} ${n === 1 ? 'is' : 'are'} ready to chat.`
  return { title, body }
}
