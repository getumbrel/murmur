import { MessageSquareShare } from 'lucide-react'

/**
 * "Continue in a new chat": a chat with an arrow leading out of it, to
 * somewhere else. (Not a fork in a road: nothing here is a branch.)
 */
export function ContinueIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <MessageSquareShare size={size} strokeWidth={1.75} className={className} aria-hidden />
}
