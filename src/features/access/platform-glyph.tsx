import { TelegramGlyph } from '@/features/telegram/telegram-glyph'
import { WhatsAppGlyph } from '@/features/whatsapp/whatsapp-glyph'
import type { AccessPlatform } from '@/state/access'

/** The platform someone wrote from, as its own little badge (nothing for one Murmur has no mark for). */
export function PlatformGlyph({ platform, size, ring }: { platform: AccessPlatform; size: number; ring?: boolean }) {
  if (platform === 'telegram') return <TelegramGlyph size={size} ring={ring} />
  if (platform === 'whatsapp') return <WhatsAppGlyph size={size} ring={ring} />
  return null
}
