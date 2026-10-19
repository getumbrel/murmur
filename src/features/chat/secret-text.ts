import type { ChatItem } from './types'

/** One line for a masked ask, where the card itself isn't shown: a notification, the agent's status. */
export function secretAskText(item: Extract<ChatItem, { kind: 'secret' }>) {
  switch (item.ask) {
    case 'login':
      return item.site ? `Needs your login for ${item.site}` : 'Needs a login'
    case 'code':
      return item.site ? `Needs a code for ${item.site}` : 'Needs a sign-in code'
    case 'key':
      return item.skill ? `Needs a key for ${item.skill}` : 'Needs a key'
  }
}
