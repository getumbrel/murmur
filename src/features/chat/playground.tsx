// Dev-only playground: Thread + Composer with fake data and simulated
// streaming, so the chat can be designed and reviewed without Hermes.
// Scenes: ?scene=solo | live | group | empty | media | cards | helpers | wakes | errors. Sending anything plays a reply.
// (media shows files from the connected Hermes: /opt/data/murmur-media-test.)

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Orb, OrbStack } from '@/ui/orb'
import { Segmented } from '@/ui/segmented'
import type { ApprovalChoice, ChatItem, Speaker } from './types'
import { ErrorNote, Thread } from './thread'
import { Toaster, toast } from 'sonner'
import { ERROR_ACTION_LABEL, explainError } from './errors'
import { Composer, useKeyboardInset, type PlusItem } from './composer'
import { AppStack } from '@/features/apps/apps-glyph'
import { CardFace } from '@/features/vault/card-face'
import { SiteIcon } from '@/features/vault/site-icon'
import { AppsIcon, CardIcon, IconChip, PasswordsIcon } from '@/ui/icons'
import { toolLabel } from './tool-labels'

const ATLAS: Speaker = { id: 'atlas', name: 'Atlas', hue: 278 }

/** The + menu's apps, passwords and cards, as an agent with a few would show them (?apps=none for one with none yet). */
const none = new URLSearchParams(location.search).get('apps') === 'none'
const MORE: PlusItem[] = [
  {
    key: 'apps',
    label: 'Apps',
    icon: <IconChip icon={AppsIcon} size={32} radius={10} />,
    aside: none ? undefined : <AppStack names={['gmail', 'slack', 'github']} />,
    detail: none ? 'Email, Google Calendar and more' : 'Gmail, Slack and GitHub',
    onSelect: () => toast('The Apps sheet opens here.'),
  },
  {
    key: 'passwords',
    label: 'Passwords',
    icon: <IconChip icon={PasswordsIcon} size={32} radius={10} />,
    aside: none ? undefined : (
      <AppStack names={['github.com', 'amazon.com']} icon={(host, size) => <SiteIcon host={host} size={size} />} />
    ),
    detail: none ? 'Let Atlas sign in for you' : 'github.com and amazon.com',
    onSelect: () => toast('The Passwords sheet opens here.'),
  },
  {
    key: 'cards',
    label: 'Cards',
    icon: <IconChip icon={CardIcon} size={32} radius={10} />,
    aside: none ? undefined : <CardFace size="row" brand="visa" />,
    detail: none ? 'Let Atlas check out for you' : 'Visa •••• 4242',
    onSelect: () => toast('The Passwords sheet opens on its cards here.'),
  },
]
const JUNIPER: Speaker = { id: 'juniper', name: 'Juniper', hue: 160 }
const WREN: Speaker = { id: 'wren', name: 'Wren', hue: 28 }

type Scene =
  | 'solo'
  | 'live'
  | 'group'
  | 'empty'
  | 'media'
  | 'cards'
  | 'secrets'
  | 'pay'
  | 'helpers'
  | 'wakes'
  | 'errors'

let n = 0
const uid = (p: string) => `${p}-${++n}`
const T0 = Date.now() - 1000 * 60 * 20

function tool(name: string, args: object, at: number, took: number, speaker?: Speaker): ChatItem {
  const { label, detail } = toolLabel(name, args)
  return {
    kind: 'tool',
    id: uid('tool'),
    name,
    label,
    detail,
    status: 'done',
    startedAt: at,
    endedAt: at + took,
    speaker,
  }
}

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6c28b"/><stop offset="1" stop-color="#e98a6b"/></linearGradient></defs><rect width="400" height="300" fill="url(#s)"/><circle cx="290" cy="120" r="34" fill="#fff3d6"/><path d="M0 210 L90 140 L170 200 L250 130 L400 230 L400 300 L0 300Z" fill="#6b4a63"/><path d="M0 250 L120 190 L220 250 L320 200 L400 250 L400 300 L0 300Z" fill="#3e2d48"/></svg>`,
)}`

const RUST_ANSWER = `Short version: return \`Result\` from every async function, use \`?\` to bubble errors up, and give your app **one error type** with [\`thiserror\`](https://docs.rs/thiserror) (libraries) or \`anyhow\` (apps).

### A small example

\`\`\`rust
use anyhow::{Context, Result};

async fn fetch_profile(id: u64) -> Result<Profile> {
    let res = reqwest::get(format!("https://api.example.com/u/{id}"))
        .await
        .context("couldn't reach the profile service")?;

    let profile = res.json::<Profile>().await?;
    Ok(profile)
}
\`\`\`

A few things worth knowing:

1. \`?\` works in async functions exactly like in sync ones.
2. Add \`.context(...)\` where a failure would otherwise be a mystery.
3. Errors inside \`tokio::spawn\` come back as a \`JoinError\`, so check both layers.

| Crate | Best for | Adds context |
|---|---|---|
| anyhow | Apps and scripts | Yes |
| thiserror | Libraries | You define it |
| eyre | Apps with rich reports | Yes |

If you tell me what you're building, I can sketch the error type for it.`

const WEEKEND = `Here’s a relaxed plan for **Saturday in Lisbon**:

- **Morning:** pastéis de nata at Manteigaria, then a slow walk up through Alfama.
- **Afternoon:** tram 28 to Estrela, coffee in the garden.
- **Evening:** sunset at Miradouro da Senhora do Monte.

Want me to book a table for dinner?`

function soloHistory(pending: boolean): ChatItem[] {
  const t = T0
  const items: ChatItem[] = [
    {
      kind: 'user',
      id: uid('u'),
      text: 'What’s the cleanest way to handle errors in async Rust? An example would help.',
      at: t,
    },
    {
      kind: 'thinking',
      id: uid('th'),
      text: 'They want idiomatic async error handling. The answer is mostly the same as sync Rust: Result and the ? operator. Worth mentioning anyhow vs thiserror, and the JoinError gotcha with tokio::spawn. A short code sample plus a comparison table should cover it without overwhelming them.',
      streaming: false,
      startedAt: t + 1000,
      endedAt: t + 9000,
    },
    tool('web_search', { query: 'rust async error handling best practices' }, t + 9000, 2100),
    tool('web_extract', { urls: ['https://tokio.rs/tokio/tutorial/spawning'] }, t + 11200, 1400),
    tool('read_file', { path: '/home/umbrel/notes/rust.md' }, t + 12700, 300),
    { kind: 'assistant', id: uid('a'), text: RUST_ANSWER, streaming: false, at: t + 13500 },
    { kind: 'user', id: uid('u'), text: 'Where was this taken?', images: [PHOTO], at: t + 60_000 },
    tool('vision_analyze', {}, t + 61_000, 3200),
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'It looks like dusk over layered hills, with a low sun and warm haze. There’s no landmark to pin it down, but the light suggests late summer.',
      streaming: false,
      at: t + 65_000,
    },
    { kind: 'user', id: uid('u'), text: 'Clear out the old build caches, they’re taking up space.', at: t + 120_000 },
    tool('terminal', { command: 'du -sh /tmp/build-cache' }, t + 121_000, 900),
    {
      kind: 'approval',
      id: uid('ap'),
      requestId: 'r1',
      title: 'Atlas wants to delete files',
      command: 'rm -rf /tmp/build-cache',
      choices: ['once', 'session', 'always', 'deny'],
      status: 'approved',
      choice: 'once',
    },
    tool('terminal', { command: 'rm -rf /tmp/build-cache' }, t + 126_000, 1200),
    { kind: 'assistant', id: uid('a'), text: 'Done. That freed up **1.2 GB**.', streaming: false, at: t + 128_000 },
  ]
  if (pending) {
    items.push(
      { kind: 'user', id: uid('u'), text: 'Can you update the server too?', at: t + 200_000 },
      tool('terminal', { command: 'apt list --upgradable' }, t + 201_000, 2400),
      {
        kind: 'approval',
        id: uid('ap'),
        requestId: 'r2',
        title: 'Atlas wants to run a command',
        command:
          'sudo apt-get update && sudo apt-get upgrade -y --with-new-pkgs -o Dpkg::Options::="--force-confold" && sudo systemctl restart umbrel-app-proxy nginx docker',
        choices: ['once', 'session', 'always', 'deny'],
        status: 'pending',
      },
    )
  }
  return items
}

const INBOX = `Here’s the newest 50, sorted.

**Keep in your inbox (4)**
- **Stripe:** payout for October failed. Needs a new bank detail by Friday.
- **Lena (Acme):** asks if the pilot can start Nov 3. Waiting on you.
- **Two support threads** where a customer is stuck on setup.

**Archive (19):** receipts, shipping updates and calendar replies.

**Safe to trash (27):** newsletters, promos and Intercom copies of tickets you’ve already answered.

Nothing has changed in Gmail yet. Say the word and I’ll archive and trash these.`

/** Hermes waking the agent on its own: helpers back from the background, a command done, a reply picked up. */
function wakesHistory(): ChatItem[] {
  const t = T0
  const errand = 'deleg_d390b76f'
  return [
    {
      kind: 'user',
      id: uid('u'),
      text: 'Lots of junk in my Gmail. Go through it carefully, newest first, 50 at a time: tell me what matters and what’s safe to trash.',
      at: t,
    },
    tool('mcp__gmail__search', { query: 'in:inbox newer_than:30d' }, t + 2000, 2400),
    tool('read_file', { path: '/opt/data/email_triage/selected.json' }, t + 5000, 300),
    tool('execute_code', {}, t + 6000, 4200),
    {
      kind: 'helper',
      id: 'helper-sa-7f3c',
      subagentId: 'sa-7f3c',
      goal: 'Read-only review of the support and feedback emails in this batch',
      status: 'done',
      tools: 9,
      startedAt: t + 12_000,
      endedAt: t + 122_000,
      summary: 'Two customers are stuck on setup; the rest are copies of answered tickets.',
      delegationId: errand,
    },
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'The main review is done. A helper is checking the support and feedback emails, so nothing important hides in those notifications. Nothing in Gmail has changed.',
      streaming: false,
      at: t + 13_000,
    },
    {
      kind: 'wake',
      id: 'wake-1',
      reason: 'helpers',
      at: t + 123_000,
      delegationId: errand,
      helpers: 1,
      failed: 0,
      took: 110_000,
      subagentIds: ['sa-7f3c'],
    },
    tool('read_file', { path: '/opt/data/email_triage/review.json' }, t + 125_000, 400),
    { kind: 'assistant', id: uid('a'), text: INBOX, streaming: false, at: t + 131_000 },
    { kind: 'user', id: uid('u'), text: 'Great. Clear out the old build caches in the background too.', at: t + 200_000 },
    tool('terminal', { command: 'rm -rf ~/build-cache/*' }, t + 201_000, 800),
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'Started. It’s a big folder, so I’ll let you know when it’s done.',
      streaming: false,
      at: t + 203_000,
    },
    { kind: 'wake', id: 'wake-2', reason: 'command', at: t + 290_000 },
    { kind: 'assistant', id: uid('a'), text: 'The build caches are gone. That freed **14.2 GB**.', streaming: false, at: t + 293_000 },
    { kind: 'wake', id: 'wake-3', reason: 'resume', at: t + 400_000 },
    tool('mcp__gmail__modify', {}, t + 401_000, 1800),
    { kind: 'assistant', id: uid('a'), text: 'Sorry, I restarted partway through archiving. All 19 are archived now.', streaming: false, at: t + 404_000 },
  ]
}

const BATCH = [
  'Read the full ASUS thread for batch email #41 and summarize its actionable status, deadlines, and who owes the next reply',
  'Review all Intercom notification threads and Youform threads in this batch; read full messages and flag anything that needs a reply',
]

/** Helpers out in the background while the chat carries on; they come back on their own (see useErrand). */
function helpersHistory(): ChatItem[] {
  const t = Date.now() - 70_000
  return [
    { kind: 'user', id: uid('u'), text: 'Go through today’s support batch and tell me what actually needs me', at: t - 8000 },
    tool('mcp__gmail__search', { query: 'label:support newer_than:1d' }, t - 6000, 2400),
    tool('mcp__gmail__read_email', { id: 'batch-41' }, t - 3000, 1800),
    ...BATCH.map(
      (goal, i): ChatItem => ({
        kind: 'helper',
        id: `helper-sa-${i}`,
        subagentId: `sa-${i}`,
        goal,
        status: 'running',
        line: i ? 'Searching email · Youform' : 'Reading an email · RMA approved for ROG Ally X',
        tools: i ? 4 : 6,
        startedAt: t,
        delegationId: 'deleg_batch',
        background: true,
      }),
    ),
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'Most of the batch is routine. Two threads are long, so I’ve asked two helpers to read them in full. I’ll pull it all together when they’re back.',
      streaming: false,
      at: t + 1000,
    },
    { kind: 'user', id: uid('u'), text: 'While they’re at it, what did the Shopify customer want?', at: t + 30_000 },
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'Maya Chen wants to change the shipping address on order **#2231** before it ships tomorrow morning.\n\n- **Old address:** 18 Wren Street, Portland, OR 97209\n- **New address:** 402 Alder Avenue, Apt 3, Portland, OR 97205\n\nThe order hasn’t been packed yet, so it’s an easy change in Shopify. Want me to update it and reply to her?',
      streaming: false,
      at: t + 34_000,
    },
    { kind: 'user', id: uid('u'), text: 'Yes please, and let her know', at: t + 50_000 },
    tool('mcp__shopify__update_order', { id: '2231' }, t + 52_000, 1400),
    tool('mcp__gmail__reply', { thread: 'maya-chen' }, t + 54_000, 1100),
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'Done. Order **#2231** now ships to 402 Alder Avenue, and I told Maya it’s updated and still going out tomorrow.',
      streaming: false,
      at: t + 56_000,
    },
  ]
}

/** What the helpers in helpersHistory get up to, and how each one comes back. */
const ERRAND: { at: number; i: number; run: (h: Extract<ChatItem, { kind: 'helper' }>) => Partial<ChatItem> }[] = [
  { at: 2500, i: 0, run: () => ({ line: 'Reading an email · Re: Serial number for RMA', tools: 7 }) },
  { at: 4000, i: 1, run: () => ({ line: 'Reading an email · Refund request #1182', tools: 5 }) },
  { at: 6500, i: 1, run: () => ({ line: 'Reading an email · Export page shows a blank CSV', tools: 6 }) },
  {
    at: 9000,
    i: 0,
    run: () => ({
      status: 'done',
      tools: 9,
      endedAt: Date.now(),
      line: undefined,
      summary: 'ASUS approved the RMA. They need the serial number by Friday, and the next reply is ours.',
    }),
  },
  { at: 12_000, i: 1, run: () => ({ line: 'Searching email · Intercom', tools: 11 }) },
  { at: 16_000, i: 1, run: () => ({ status: 'error', tools: 14, endedAt: Date.now(), line: 'Ran out of time' }) },
]

/** Plays helpersHistory's helpers out: they work, come back, and the agent picks it up. */
function useErrand(on: boolean, setItems: (fn: (it: ChatItem[]) => ChatItem[]) => void) {
  useEffect(() => {
    if (!on) return
    const timers = ERRAND.map(({ at, i, run }) =>
      window.setTimeout(
        () =>
          setItems((it) =>
            it.map((x) =>
              x.kind === 'helper' && x.subagentId === `sa-${i}` && x.status === 'running'
                ? ({ ...x, ...run(x) } as ChatItem)
                : x,
            ),
          ),
        at,
      ),
    )
    timers.push(
      window.setTimeout(
        () =>
          setItems((it) => [
            ...it,
            {
              kind: 'wake',
              id: uid('wake'),
              reason: 'helpers',
              at: Date.now(),
              delegationId: 'deleg_batch',
              helpers: 2,
              failed: 1,
              subagentIds: ['sa-0', 'sa-1'],
            },
            {
              kind: 'assistant',
              id: uid('a'),
              text: 'The ASUS thread is done, but the Intercom and Youform helper ran out of time before it finished.\n\n**ASUS RMA (#41):** they approved the replacement and need the serial number by **Friday**.\n\nWant me to go through the Intercom and Youform threads myself?',
              streaming: false,
              at: Date.now(),
            },
          ]),
        17_500,
      ),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [on, setItems])
}

function groupHistory(): ChatItem[] {
  const t = T0
  return [
    { kind: 'user', id: uid('u'), text: 'Let’s plan a weekend in Lisbon. Ideas?', at: t },
    tool('web_search', { query: 'lisbon weekend october' }, t + 1000, 1800, JUNIPER),
    { kind: 'assistant', id: uid('a'), text: WEEKEND, streaming: false, at: t + 4000, speaker: JUNIPER },
    tool('session_search', { query: 'lisbon' }, t + 6000, 700, WREN),
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'Last time you mentioned you’re vegetarian, so I’d swap dinner for **Ao 26**. They do a lovely tasting menu.',
      streaming: false,
      at: t + 8000,
      speaker: WREN,
    },
    {
      kind: 'assistant',
      id: uid('a'),
      text: 'I can keep an eye on flight prices. Before I do:',
      streaming: false,
      at: t + 10_000,
      speaker: ATLAS,
    },
    {
      kind: 'clarify',
      id: uid('cl'),
      requestId: 'c1',
      status: 'pending',
      speaker: ATLAS,
      questions: [
        {
          qid: 'from',
          question: 'Which airport are you flying from?',
          choices: ['London Heathrow', 'Gatwick', 'Stansted'],
        },
        { qid: 'when', question: 'Which days work?', choices: ['Fri – Sun', 'Sat – Mon', 'Thu – Sun'], multi: true },
      ],
    },
  ]
}

// ── Simulated agent ──────────────────────────────────────────────────────────

type Step = { wait: number; run: (items: ChatItem[]) => ChatItem[] }

function replyScript(speaker?: Speaker): Step[] {
  const thinkId = uid('th')
  const t1 = uid('tool')
  const t2 = uid('tool')
  const aId = uid('a')
  const now = () => Date.now()
  const reasoning =
    'Let me look up current guidance first, then check the official docs so the example compiles on the latest version.'
  const steps: Step[] = [
    {
      wait: 500,
      run: (it) => [...it, { kind: 'thinking', id: thinkId, text: '', streaming: true, startedAt: now(), speaker }],
    },
  ]
  for (const chunk of reasoning.match(/.{1,6}/g) ?? []) {
    steps.push({
      wait: 40,
      run: (it) => it.map((i) => (i.id === thinkId && i.kind === 'thinking' ? { ...i, text: i.text + chunk } : i)),
    })
  }
  const done =
    (id: string) =>
    (it: ChatItem[]): ChatItem[] =>
      it.map((i) => {
        if (i.id !== id) return i
        if (i.kind === 'tool') return { ...i, status: 'done', endedAt: now() }
        if (i.kind === 'thinking') return { ...i, streaming: false, endedAt: now() }
        return i
      })
  const start = (id: string, name: string, args: object) => (it: ChatItem[]) => {
    const { label, detail } = toolLabel(name, args)
    return [...it, { kind: 'tool', id, name, label, detail, status: 'running', startedAt: now(), speaker } as ChatItem]
  }
  steps.push(
    { wait: 300, run: done(thinkId) },
    { wait: 200, run: start(t1, 'web_search', { query: 'rust async error handling' }) },
    { wait: 2200, run: done(t1) },
    { wait: 300, run: start(t2, 'browser_navigate', { url: 'https://docs.rs/anyhow/latest/anyhow/' }) },
    { wait: 1800, run: done(t2) },
    { wait: 500, run: (it) => [...it, { kind: 'assistant', id: aId, text: '', streaming: true, at: now(), speaker }] },
  )
  for (const chunk of RUST_ANSWER.match(/[\s\S]{1,5}/g) ?? []) {
    steps.push({
      wait: 18,
      run: (it) => it.map((i) => (i.id === aId && i.kind === 'assistant' ? { ...i, text: i.text + chunk } : i)),
    })
  }
  steps.push({
    wait: 100,
    run: (it) => it.map((i) => (i.id === aId && i.kind === 'assistant' ? { ...i, streaming: false } : i)),
  })
  return steps
}

function useSimulation(initial: () => ChatItem[]) {
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const stop = useCallback(() => {
    window.clearTimeout(timer.current)
    setBusy(false)
    setItems((it) =>
      it.map((i) =>
        i.kind === 'assistant' && i.streaming
          ? { ...i, streaming: false }
          : i.kind === 'tool' && i.status === 'running'
            ? { ...i, status: 'error', endedAt: Date.now() }
            : i,
      ),
    )
  }, [])

  const play = useCallback((steps: Step[]) => {
    window.clearTimeout(timer.current)
    setBusy(true)
    let i = 0
    const tick = () => {
      const step = steps[i++]
      if (!step) return setBusy(false)
      timer.current = window.setTimeout(() => {
        setItems(step.run)
        tick()
      }, step.wait)
    }
    tick()
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { items, setItems, busy, setBusy, play, stop }
}

function Chat({ scene }: { scene: Scene }) {
  const group = scene === 'group'
  const { items, setItems, busy, setBusy, play, stop } = useSimulation(() =>
    scene === 'solo'
      ? soloHistory(true)
      : scene === 'live'
        ? [
            ...soloHistory(false).slice(0, 9),
            { kind: 'user', id: uid('u'), text: 'Show me async error handling in Rust again?', at: Date.now() },
          ]
        : scene === 'group'
          ? groupHistory()
          : scene === 'media'
            ? mediaHistory()
            : scene === 'cards'
              ? cardsHistory()
              : scene === 'secrets'
                ? secretsHistory()
                : scene === 'wakes'
                  ? wakesHistory()
                  : scene === 'helpers'
                    ? helpersHistory()
                    : scene === 'pay'
                      ? payHistory()
                      : [],
  )
  const inset = useKeyboardInset()
  useErrand(scene === 'helpers', setItems)

  useEffect(() => {
    if (scene === 'solo' || scene === 'group') setBusy(true)
    if (scene === 'live') play(replyScript())
  }, [scene, play, setBusy])

  const send = (text: string, files: File[]) => {
    const images = files.map((f) => URL.createObjectURL(f))
    setItems((it) => [...it, { kind: 'user', id: uid('u'), text, images, at: Date.now() }])
    play(replyScript(group ? JUNIPER : undefined))
  }

  const approve = (requestId: string, choice: ApprovalChoice) => {
    window.setTimeout(() => {
      setItems((it) =>
        it.map((i) =>
          i.kind === 'approval' && i.requestId === requestId
            ? { ...i, status: choice === 'deny' ? 'denied' : 'approved', choice }
            : i,
        ),
      )
      if (choice === 'deny') {
        setBusy(false)
        setItems((it) => [
          ...it,
          {
            kind: 'assistant',
            id: uid('a'),
            text: 'No problem, I’ll leave the server as it is.',
            streaming: false,
            at: Date.now(),
          },
        ])
      } else {
        const a = uid('tool')
        play([
          {
            wait: 200,
            run: (it) => [
              ...it,
              {
                ...(tool('terminal', { command: 'sudo apt-get upgrade -y' }, Date.now(), 0) as Extract<
                  ChatItem,
                  { kind: 'tool' }
                >),
                id: a,
                status: 'running',
                endedAt: undefined,
              },
            ],
          },
          {
            wait: 2600,
            run: (it) =>
              it.map((i) => (i.id === a && i.kind === 'tool' ? { ...i, status: 'done', endedAt: Date.now() } : i)),
          },
          {
            wait: 400,
            run: (it) => [
              ...it,
              {
                kind: 'assistant',
                id: uid('a'),
                text: 'All up to date. **14 packages** were upgraded and the services restarted cleanly.',
                streaming: false,
                at: Date.now(),
              },
            ],
          },
        ])
      }
    }, 500)
  }

  const answer = (requestId: string, answers: Record<string, string>) => {
    window.setTimeout(() => {
      setItems((it) =>
        it.map((i) => (i.kind === 'clarify' && i.requestId === requestId ? { ...i, status: 'answered', answers } : i)),
      )
      play([
        {
          wait: 600,
          run: (it) => [
            ...it,
            {
              kind: 'assistant',
              id: uid('a'),
              text: `Got it. I’ll watch fares from **${answers.from}** and let you know when they dip.`,
              streaming: false,
              at: Date.now(),
              speaker: ATLAS,
            },
          ],
        },
      ])
    }, 500)
  }

  const retry = () => {
    setItems((it) => {
      const lastUser = it.findLastIndex((i) => i.kind === 'user')
      return it.slice(0, lastUser + 1)
    })
    play(replyScript(group ? JUNIPER : undefined))
  }

  const agentHue = group ? undefined : ATLAS.hue

  return (
    <div className="flex h-dvh flex-col" style={agentHue ? ({ '--hue': agentHue } as CSSProperties) : undefined}>
      <header className="glass hairline-b safe-top relative z-20 flex-none">
        <div className="mx-auto flex h-14 max-w-[720px] items-center gap-3 px-4 sm:px-6">
          {group ? (
            <OrbStack hues={[ATLAS.hue, JUNIPER.hue, WREN.hue]} seeds={['atlas', 'juniper', 'wren']} size={32} />
          ) : (
            <Orb hue={ATLAS.hue} size={32} seed="atlas" state={busy ? 'working' : 'idle'} />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-subhead font-semibold tracking-[-0.01em]">
              {group ? 'Weekend plans' : 'Atlas'}
            </h1>
            <p className="truncate text-caption text-ink-3">
              {group ? 'Atlas, Juniper and Wren' : busy ? 'Working…' : 'Here for you'}
            </p>
          </div>
        </div>
      </header>
      <Thread
        className="flex-1"
        items={items}
        busy={busy}
        agent={group ? undefined : ATLAS}
        onApprove={approve}
        onAnswer={answer}
        onSecret={(requestId, value) =>
          window.setTimeout(
            () =>
              setItems((it) =>
                it.map((i) =>
                  i.kind === 'secret' && i.requestId === requestId ? { ...i, status: value ? 'sent' : 'skipped' } : i,
                ),
              ),
            500,
          )
        }
        onRetry={retry}
        onStopHelper={(subagentId) =>
          setItems((it) =>
            it.map((i) =>
              i.kind === 'helper' && i.subagentId === subagentId && i.status === 'running'
                ? { ...i, status: 'stopped', line: undefined, endedAt: Date.now() }
                : i,
            ),
          )
        }
        emptyState={
          <div className="flex flex-col items-center gap-4 pb-16 text-center">
            <Orb hue={ATLAS.hue} size={96} seed="atlas" />
            <div>
              <h2 className="text-title font-semibold tracking-[-0.02em]">Atlas</h2>
              <p className="mt-1 max-w-72 text-subhead text-balance text-ink-2">
                Ask anything. I can search, read and get things done.
              </p>
            </div>
          </div>
        }
        footer={
          <div style={{ paddingBottom: inset }}>
            <Composer
              onSend={send}
              onStop={stop}
              busy={busy}
              draftKey={`playground-${scene}`}
              placeholder={group ? 'Message the group' : 'Message Atlas'}
              more={group ? undefined : MORE}
              // Dictation transcribes with the main agent's speech settings.
              voice="default"
            />
          </div>
        }
      />
    </div>
  )
}

const MEDIA_DIR = '/opt/data/murmur-media-test'

function mediaHistory(): ChatItem[] {
  const at = T0
  return [
    {
      kind: 'user',
      id: uid('u'),
      text: 'Here’s the photo and my notes',
      at,
      attachments: [
        { kind: 'image', name: 'sunny.png', path: `${MEDIA_DIR}/sunny.png` },
        { kind: 'file', name: 'list.md', path: `${MEDIA_DIR}/list.md`, size: 47 },
      ],
    },
    {
      kind: 'assistant',
      id: uid('a'),
      at,
      streaming: false,
      text: `Here’s everything, all in one place.\n\nMEDIA:${MEDIA_DIR}/sunny.png\n\nA short clip:\n\nMEDIA:${MEDIA_DIR}/clip.mp4\n\nAnd the tone: MEDIA:${MEDIA_DIR}/tone.mp3\n\nYour files:\n\nMEDIA:${MEDIA_DIR}/list.md\nMEDIA:${MEDIA_DIR}/data.json\nMEDIA:${MEDIA_DIR}/bundle.zip\n\nA remote one too:\n\n![A mountain lake](https://picsum.photos/id/1018/800/500)\n\n::preview{file="/opt/data/fruits-chart.html"}`,
    },
  ]
}

/** The quieter pieces of a thread: a notice, a side question, a command's output, an error. */
/** Hermes asking for what it must never see: a login, a code, a key. Then how each one settles. */
function secretsHistory(): ChatItem[] {
  const at = T0
  const ask = (ask: 'login' | 'code' | 'key', status: 'pending' | 'sent' | 'skipped' | 'expired', more: object = {}): ChatItem => ({
    kind: 'secret',
    id: uid('sc'),
    requestId: uid('r'),
    ask,
    status,
    speaker: ATLAS,
    ...more,
  })
  return [
    { kind: 'user', id: uid('u'), text: 'Book my usual table at Taberna da Rua das Flores', at },
    ask('login', 'sent', { site: 'tabernadaruadasflores.pt' }),
    ask('code', 'skipped', { site: 'tabernadaruadasflores.pt' }),
    ask('key', 'expired', { prompt: 'Enter your OpenTable API key', skill: 'opentable' }),
    { kind: 'assistant', id: uid('a'), at, streaming: false, text: 'Signed in. Their booking page wants one more thing:' },
    ask('login', 'pending', { site: 'opentable.com' }),
    ask('code', 'pending', { site: 'opentable.com', prompt: 'Sent by text to the number ending 42.' }),
    ask('key', 'pending', {
      prompt: 'Your OpenTable API key',
      skill: 'opentable',
      help: 'Find it at opentable.com/developers under Keys.',
    }),
  ]
}

/** A checkout: the agent's about to enter a card saved for any website. */
function payHistory(): ChatItem[] {
  const at = T0
  return [
    { kind: 'user', id: uid('u'), text: 'Order the Anker 7-in-1 USB-C hub from Best Buy, and ship it home', at },
    tool('browser_navigate', { url: 'https://www.bestbuy.com/anker-7-in-1-usb-c-hub' }, at + 1000, 2400),
    tool('browser_click', { element: 'Add to cart' }, at + 3600, 800),
    tool('browser_navigate', { url: 'https://www.bestbuy.com/checkout' }, at + 4600, 1900),
    {
      kind: 'assistant',
      id: uid('a'),
      at,
      streaming: false,
      text: 'It’s in your cart: **$39.99**, free shipping, here Friday. Paying with your Visa.',
    },
    {
      kind: 'approval',
      id: uid('ap'),
      requestId: 'pay',
      title: 'Atlas wants to pay with your card',
      command: 'www.bestbuy.com',
      prose: true,
      payment: { card: 'Visa •••• 4242', host: 'www.bestbuy.com', site: 'bestbuy.com', first: true },
      choices: ['once', 'deny'],
      status: 'pending',
    },
  ]
}

function cardsHistory(): ChatItem[] {
  const at = T0
  return [
    { kind: 'notice', id: uid('n'), text: 'Atlas switched to GPT‑6.1 Sol for this chat' },
    { kind: 'user', id: uid('u'), text: 'Find me a quiet café near Alfama with good Wi‑Fi', at },
    { kind: 'assistant', id: uid('a'), at, streaming: false, text: 'Try **Copenhagen Coffee Lab** on Rua Nova da Piedade: calm, big tables and fast Wi‑Fi.' },
    {
      kind: 'aside',
      id: uid('s'),
      question: 'Do they take cards?',
      answer: 'Yes, cards and Apple Pay. There’s no minimum spend.',
      status: 'done',
    },
    {
      kind: 'command',
      id: uid('c'),
      command: '/usage',
      output: 'Today        12 replies   48 steps\nThis week    61 replies  233 steps\nThis month  240 replies  911 steps',
      status: 'done',
    },
    { kind: 'user', id: uid('u'), text: 'https://www.example.com/a/really/long/link/that/keeps/going/and/going/without/any/spaces/at/all?ref=murmur', at },
    { kind: 'error', id: uid('e'), message: 'Atlas couldn’t finish that reply. The connection dropped partway through.', retryable: true },
  ]
}

const SCENES: { value: Scene; label: string }[] = [
  { value: 'media', label: 'Media' },
  { value: 'solo', label: 'Solo' },
  { value: 'live', label: 'Live' },
  { value: 'group', label: 'Group' },
  { value: 'empty', label: 'Empty' },
  { value: 'cards', label: 'Cards' },
  { value: 'secrets', label: 'Logins' },
  { value: 'pay', label: 'Pay' },
  { value: 'helpers', label: 'Helpers' },
  { value: 'wakes', label: 'Wakes' },
  { value: 'errors', label: 'Errors' },
]

/** Raw errors as Hermes passes them on, and what Murmur says instead. */
const RAW_ERRORS = [
  'Error code: 401 - {"error": {"message": "Incorrect API key provided: sk-proj-***", "code": "invalid_api_key"}}',
  'anthropic.AuthenticationError: invalid x-api-key',
  'Error code: 429 - {"error": {"message": "You exceeded your current quota, please check your plan and billing details.", "code": "insufficient_quota"}}',
  'Your credit balance is too low to access the Anthropic API.',
  "This model's maximum context length is 128000 tokens. However, your messages resulted in 130512 tokens.",
  'prompt is too long: 210000 tokens > 200000 maximum',
  'Rate limit reached for gpt-4o on tokens per min. Please try again in 6s.',
  'Tool crashed: unexpected EOF while parsing\nTraceback (most recent call last): …',
]

function ErrorsGallery() {
  return (
    <div className="hue-scope min-h-dvh bg-bg" style={{ '--hue': ATLAS.hue } as CSSProperties}>
      <div className="mx-auto max-w-[736px] space-y-6 px-4 pt-[calc(env(safe-area-inset-top)+24px)] pb-16 sm:px-6">
        <h1 className="text-title font-semibold tracking-[-0.02em]">Errors</h1>
        {RAW_ERRORS.map((raw) => {
          const { text, action } = explainError(raw)
          return (
            <section key={raw} className="space-y-2">
              <p className="font-mono text-caption break-words text-ink-3">
                {raw.split('\n')[0]}
                <span className="ml-2 font-sans font-medium text-ink-2">→ {action ? ERROR_ACTION_LABEL[action] : 'no action'}</span>
              </p>
              <ErrorNote
                item={{ kind: 'error', id: raw, message: text, retryable: true }}
                onRetry={() => toast('Trying again')}
                onAction={(a) => toast(ERROR_ACTION_LABEL[a])}
              />
            </section>
          )
        })}
      </div>
      <Toaster position="top-center" toastOptions={{ className: 'murmur-toast' }} />
    </div>
  )
}

export function Playground() {
  const [scene, setScene] = useState<Scene>(() => {
    const s = new URLSearchParams(location.search).get('scene')
    return SCENES.some((o) => o.value === s) ? (s as Scene) : 'live'
  })
  const pick = (s: Scene) => {
    history.replaceState(null, '', `?scene=${s}`)
    setScene(s)
  }
  return (
    <>
      {scene === 'errors' ? <ErrorsGallery /> : <Chat key={scene} scene={scene} />}
      {!new URLSearchParams(location.search).has('bare') && (
        <div className="fixed top-[calc(env(safe-area-inset-top)+10px)] right-3 z-30 hidden sm:block">
          <Segmented value={scene} options={SCENES} onChange={pick} className="glass shadow-float" />
        </div>
      )}
    </>
  )
}
