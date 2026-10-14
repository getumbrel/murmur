import { createContext, useContext } from 'react'

/**
 * What media inside a message needs to know about its chat. Optional: without
 * it files still load by path, widgets just can't talk back.
 */
export type MediaContext = {
  /** The chat's stored id, so Hermes can check the file belongs to it. */
  sessionId?: string
  /** The agent the chat is with. */
  profile?: string
  /** Bumps each time a reply finishes, so widgets re-read their file. */
  revision?: number
  /** A widget asked to send a prompt as a hidden turn. Resolves false if it couldn't. */
  onWidgetSend?: (prompt: string) => Promise<boolean> | boolean
}

const Ctx = createContext<MediaContext>({})

export const MediaProvider = Ctx.Provider
export const useMediaContext = () => useContext(Ctx)
