import { motion } from 'motion/react'
import { LockKeyhole } from 'lucide-react'
import { Button } from '@/ui/button'
import { IconChip, WebsiteIcon } from '@/ui/icons'
import type { Agent } from '@/state/agents'
import { ease, Heading, lift, Pair } from './parts'
import { siteFrom } from './wall'

// Anything the wall doesn't have: if it has a website, the agent can still use
// it, signed in with a username and password saved in its Passwords. Hermes
// types them into the agent's web browser (state/vault.ts), so the agent
// never sees the password. Offered where a search finds nothing, and as the
// wall's last tile, for anyone who looks rather than searches.

/** A website on the agent's colour, as an app icon: the Other tile, and the app in its Pair. */
export function WebsiteArt({ size, className }: { size: number; className?: string }) {
  return <IconChip icon={WebsiteIcon} size={size} radius={Math.round(size * 0.2237)} className={className} />
}

export function OtherApp({
  agent,
  query,
  onAddLogin,
}: {
  agent: Agent
  /** What a search didn't find. */
  query?: string
  onAddLogin: (site?: string) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease }}
      className="pb-1"
    >
      <Pair agent={agent} icon={<WebsiteArt size={68} className={lift} />} state="linking" />
      {query ? (
        <div className="mt-5 text-center">
          <h4 className="text-body font-semibold tracking-[-0.01em] text-balance [overflow-wrap:anywhere]">
            Can’t find “{query}”?
          </h4>
          <p className="mx-auto mt-1 max-w-80 text-subhead text-balance text-ink-2">
            Save its username and password, and {agent.name} can use it in its web browser.
          </p>
        </div>
      ) : (
        <Heading title="Not on the list?">
          Save its username and password, and {agent.name} can use it in its web browser.
        </Heading>
      )}
      <div className={query ? 'mt-5 flex justify-center' : 'mt-7'}>
        <Button variant="accent" size={query ? 'md' : 'lg'} onClick={() => onAddLogin(siteFrom(query))}>
          Add a login
        </Button>
      </div>
      {/* The lock sits in the line, so it stays with the words when a long name wraps them. */}
      <p className="mt-4 px-4 text-center text-footnote text-balance text-ink-3">
        <LockKeyhole size={13} strokeWidth={2} aria-hidden className="mr-1.5 inline-block align-[-2px]" />
        {agent.name} never sees your password.
      </p>
    </motion.div>
  )
}
