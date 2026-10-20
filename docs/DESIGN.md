# Murmur design brief

Murmur is a beautiful way to use Hermes: you have a few agents, you talk to them, alone or together. It ships on umbrelOS. People using it are not technical, and they never see Hermes jargon.

The bar: build it the way Apple would. Calm, precise, alive. Every pixel is intentional and nothing is decoration for its own sake. If something can be removed, remove it.

## Principles

1. **One thing per screen.** Each screen has a single obvious action. Secondary actions sit quietly in sheets.
2. **Alive, not busy.** Motion carries meaning: an agent's buddy shows its state, and new text rises in. Nothing moves without a reason, and everything respects `prefers-reduced-motion`.
3. **Human words.**
   - Use: "Agent", "Chat", "Group", "Model", "Thinking".
   - Never use: profile, session, toolset, skill, cron, MCP, token, provider (say "account" or "service" when you must), gateway.
   - Tool activity is a present-tense verb: "Searching the web", "Reading notes.md", "Running a command".
4. **Mobile first, desktop great.**
   - Design at 375–430px first: thumb-reachable actions, 44px minimum touch targets, safe areas, a keyboard-aware composer, `100dvh`.
   - Wide screens (≥900px) get a sidebar and centred dialogs.
5. **Light and dark are both first class.** Use only the semantic tokens and never hard-code greys.

## Tokens (src/styles.css)

**Surfaces**
- `bg`: the app background.
- `elevated`: sheets and cards.
- `sunken`: wells.
- `fill-1/2/3`: subtle fills, used for inputs, rows and chips.
- `line` / `line-strong`: hairlines.
- `glass`: floating bars, with the `glass` utility for backdrop blur. Hand-written blur always puts `-webkit-backdrop-filter` before `backdrop-filter`: the production minifier merges the pair and keeps only the last, so the other order ships with no blur outside Safari.

**Ink:** `ink`, `ink-2` (secondary, 60%), `ink-3` (tertiary, 40%).

**Accent**
- `accent`, `accent-soft` and `accent-ink` derive from the CSS variable `--hue`.
- Every agent has a hue, and inside an agent's chat `--hue` is set to it, so the whole chat subtly takes the agent's colour.
- The app default hue is 278 (violet).
- Light mode: `oklch(L 0.19 hue)` with L 0.54, eased down to 0.49 through green–cyan–sky (`--accent-l`, a cos² bump centred on 192), so white on the accent and the accent as text hold ≥4.9:1 for every hue. Dark mode: L 0.72 under dark ink (≥7:1). Never hard-code an accent with a fixed L; use the tokens.

**Status:** `danger`, `success`, `warning`.

**Type sizes**
| Token | Size |
|---|---|
| `text-caption` | 12 |
| `text-footnote` | 13 |
| `text-subhead` | 15 |
| `text-body` | 16, used for message text and inputs (≥16px keeps iOS from zooming) |
| `text-title` | 20 |
| `text-large` | 30, large titles |

- Headings: `font-semibold tracking-[-0.02em]`.
- Font: Inter Variable.

**Radii:** `sm` 8, `md` 12, `lg` 16, `xl` 22, `2xl` 28; pills use `rounded-full`.

**Shadows:** `shadow-float`, `shadow-sheet`. Prefer hairlines and fills over shadows.

**Motion**
- Curves:
  - `--ease-out` `cubic-bezier(.16,1,.3,1)` for entrances.
  - `--ease-sheet` `cubic-bezier(.32,.72,0,1)` for sheets and morphs.
  - `--ease-spring` for small overshoots.
- Durations: about 160ms for presses, 240–300ms for UI, 380–460ms for content entrances.
- Utilities:
  - `animate-rise` for assistant content.
  - `animate-pop` for the user's own bubble.
  - `animate-fade`.
  - `text-shimmer` for live activity labels.
  - `pressable`: scale .97 on press.
- Library: `motion/react`. Springs for layout, e.g. `{type:'spring', stiffness:420, damping:40}`.

**Icons:** `lucide-react`, stroke width 1.75–2, size 18–20 in bars and 16 inline.

## Primitives (src/ui)

- `Button` (primary / accent / secondary / ghost / danger; sizes sm, md, lg where lg is full width and 52px)
- `IconButton`
- `Sheet`: bottom sheet on phones with drag to dismiss; centred dialog when wide.
- `TextField`, `TextArea`, `Label`: `Label` sits 16px in, the same inset as `ListGroup` titles and footers, so every section label lines up with the text in the box below it. `Label` is a real `<label>`: give it `htmlFor`, or put the field right after it (directly, or as the only field in the next element) and it wires itself up, so tapping it focuses the field and screen readers name the field by it rather than by the placeholder. A field with its own `aria-label` keeps that name.
- `Segmented`
- `Toggle`
- `ListGroup` / `ListRow`: Settings-style inset groups.
- `Spinner`
- `Buddy`, `BuddyStack`, `BuddyRow`: agent avatars (below).

### Buddy

`<Buddy hue size state seed label />` (src/ui/buddy.tsx) is every agent's face: a plump arch with two pill eyes, one half of Murmur's "m". `hue` colours it. `seed` (the agent's id) gives each agent its own proportions, quirks and rhythm, so always pass it. BRAND.md covers the character; `/buddy.html` shows every state and size live.

- **States:**
  - `idle`: breathes, blinks and glances around.
  - `listening`: leans in with big eyes on the composer and nods now and then.
  - `speaking`: the body murmurs in syllables (group turns).
  - `thinking`: eyes drift up, lids lower, a soft light moves through the body.
  - `working`: busy little hops with eyes narrowed and scanning.
  - `waiting`: perks up with a warm amber glow, which means "needs you".
  - `done`: happy ∩ ∩ eyes, rosy cheeks and a hop.
  - `error`: a startled shiver, then a worried slump.
  - `offline`: grey and asleep.
- **Sizes:**
  - Inline: 18px on the live work line, 22px in chips and swatches, 24px for speakers in a thread, 28px for list-row icons in sheets and Settings and on approval and question cards.
  - Lists: 40px in the home roster, or 52px in the roomy layout.
  - Headers: 34px in a chat or group header.
  - Cards: 72px in All agents.
  - Heroes: 80–112px on agent sheets and empty states, 104px on an agent's page.
  - Below 24px the eyes get a size floor so the face still reads; don't go under 18px.
- **Groups:**
  - `BuddyStack hues seeds` is a group's avatar: two buddies make the "m", three huddle. Use it wherever a single agent would get a `Buddy` (40/52px in the roster).
  - `BuddyRow members speaking` stands the members side by side (34px in a group chat's header, 60px in Group info): whoever has the floor perks up and takes `speaking`, and the others lean and look toward them.
- **Hue:** `hue` is the agent's colour (an OKLCH hue angle, 0–360); the body, glow and cheeks all derive from it, so never tint a Buddy with CSS. Inside the agent's own screens `--hue` is set to the same value, so the Buddy and the page always agree.
- **Flight between screens:** an agent's face is one thing that moves. Mark the wrapper around a screen's main face (a chat header, an agent page's hero) with the marker attribute under Legacy names so `src/lib/transitions.ts` can find it; rows and cards are found by the link they sit in. During a page transition the face gets `view-transition-name: buddy` on the way out and on the way in, one at a time, so only one element on the page ever holds that name. MOTION.md describes the flight.
- **Label:** pass `label` only where the Buddy is the only name on screen (the agent page hero names the agent and what it's doing); beside a printed name it stays `aria-hidden`.

## Brand (src/ui/brand.tsx, brand.css)

The Murmur mark is two buddies, violet and coral, shoulder to shoulder so together they spell a lowercase "m". BRAND.md covers the story and the rules; `/buddy.html` shows every variant. The colours are literals in `BRAND`, because the mark is the one thing that never takes an agent's hue.

- **`MurmurMark size tile variant theme still breathe safe label`**
  - `variant`: `color` (the full soft-3D mark, the default), `glyph` (flat and bold, square crop, for favicons and anything under about 24px) and `mono` (one ink, `currentColor`).
  - `size` is the bare mark's height (its width is about 1.43× that) or a tile's side.
  - `tile` draws the app-icon square on its cream (or night) ground; `safe` shrinks the m into the maskable 80% zone. `design/icon/murmur-icon.svg` is this component's output.
  - `theme="auto"` follows the colour scheme. The two buddies blink on their own, never in unison; `breathe` adds a slow breath for a mark that is the whole screen; `still` stops both for exports. Reduced motion stops the blinking and the breath.
  - `label` names it for screen readers; pass `''` when the word "Murmur" is printed beside it.
- **`MurmurWordmark size mark`:** the lockup, mark plus "murmur" in lowercase Inter 600 with tight tracking. `size` is the mark's height and the type is sized from it, so the lockup keeps its proportions at any size.
- **`ByUmbrel mark`:** the endorsement, "Murmur by Umbrel", quiet and caption-sized. It sits at the foot of screens that stand for the product as a whole.

**Where each appears**

| Place | What | Notes |
|---|---|---|
| Splash (`src/app.tsx`) | `MurmurMark` 48, `breathe` | Only when loading is slow. Marked `data-hero="brand"`, so when the app is ready the mark settles into the header's mark. |
| Brand header (`features/connection/brand-header.tsx`) | `MurmurWordmark` 32 | Tops the pre-app screens: sign in and Connect to Hermes. `hop` makes the two buddies jump once when the screen has done its job; the word stays put. |
| Switch curtain (`features/connection/curtain.tsx`) | `MurmurMark` 48, `breathe` | Exactly where the splash puts its mark, so the one hands straight to the other. |
| Home (`screens/home.tsx`) | `MurmurWordmark` 31 (phone large title), 24 (sidebar) | The header mark the splash and welcome land on. |
| Welcome (`features/onboarding/welcome.tsx`) | `MurmurMark`, `breathe` | Where the murmuration lands. |
| Settings › About, install tip | `MurmurMark tile` | The app icon, as people will see it on their home screen. |
| Footers of sign in, Connect, welcome, done, the sidebar and Settings | `ByUmbrel` | |
| Favicon and app icons (`public/`) | Static exports of `glyph` and `tile` | Re-export from `/buddy.html` when the mark changes. |

## Patterns

- **Home with one agent** (`features/home/solo.tsx`): most people have one agent, and a roster of one is a detour. Until there's a second agent or a group, a phone's Home is that agent's chats: its card (52px live Buddy in its own soft light, name, role or what it's doing; it opens the agent page) above every chat as plain one-line rows, and New chat in the bar beside "+". Each routine that has found something is one of them, by when it last found something: its name, with what it found on a second line. Wide screens open a new chat with it, its chats folded open in the sidebar, and drop "All agents". When a second agent or a group arrives, Home gives way to the roster and the newcomer blooms in with its halo.
- **Agent page** (`/agent/:id`, `screens/agent.tsx`, `features/agent-page/`): an agent's home. A 104px live Buddy in its own soft light, its name, what it's for and its model (tap to change), then quick actions (routines, memory, Telegram, its look) and every chat with it. Phones reach it from a chat's header and go back to that chat; wide screens show it beside the sidebar. The page bar's title appears once the large name has slid under it, and going back finds the page scrolled where you left it.
- **All agents** (`/agents`, `screens/agents.tsx`): everyone you can talk to as a gallery of cards (`AgentCard`: a 72px live Buddy, name, role, and when you last talked or what it's doing now), two columns on phones, three from 600px and auto-filled 184px columns when wide. The main agent leads and the rest follow by recency. A last card makes a new agent. Cards arrive once, a beat apart, never again on the way back.
- **HermesSwitcher** (`features/connection/switcher.tsx`): several Hermes, one at a time, Slack-workspace style. A small pill with a live status dot and the Hermes's name opens a "Switch server" sheet, with a way to Settings › Server to manage them. On screen a Hermes is a "server", named for where it is ("Built-in", "Hermes Agent", "Office Mac mini"), never a bare "Hermes": Hermes calls the main agent "Hermes" too, and the two sit side by side in Settings and the sidebar. The one that comes with Murmur is **Built-in** ("Comes with Murmur · Hermes 0.22.0"; in a sentence, "Murmur's built-in Hermes"); the Umbrel app is **Hermes Agent** ("On this Umbrel · Hermes 0.22.0"), the name on the Umbrel home screen. "Hermes" stays the name of the software ("Connect to Hermes", "Can't reach Hermes", "Hermes 0.21.5"). It draws nothing until there are two, so most people never see it. It sits beside the lockup in the home title on phones and just under the sidebar's lockup when wide.
- **Where should your agents live?** (`features/onboarding/where.tsx`, wired in `setup-flow.tsx` in front of the app by `HermesGate`): the one onboarding question with no Skip. A Hermes that's already here leads as a raised card with its agents' own faces (up to five, in their colours, hopping in one by one, then "+N"), their names, "On this Umbrel · 6 agents · 100+ chats" and one accent button; a **Recommended** badge only when it holds something. Starting fresh with the built-in sits under it as a quiet row led by the main agent-to-be's face. With nothing found the built-in leads as a centred card ("Built into Murmur", a 64px Buddy in a soft glow). Out of date: the faces sleep and the card says how to update, with Check again. Behind a password: the sign-in fields sit in the card. Without a built-in (desktop, plain Docker) it's Connect to Hermes in step chrome, with what Murmur found listed first (faces as their icons) and "Don't have Hermes yet?" (`NoHermesSheet`).
- **Getting ready** (`features/onboarding/getting-ready.tsx`): the built-in's first start. A 104px working Buddy, then two steps that tick off as they really happen ("Starting up", "Making room for your agents"), never on a timer. The words admit a slow start at 45s and offer a way out at 4 minutes; a failure has its own words and Try again. A state of the gate, so a reload mid-start comes back to it.
- **Your agents are here** (`features/onboarding/arrived.tsx`): after choosing a Hermes that already has agents, they gather on screen instead of a first agent being made (see MOTION, Gathering). Built like Done.
- **Suggestions in Settings › Server**: a Hermes Murmur found but hasn't added (or the built-in before it's been used) waits in its own group ("Found on this Umbrel") with a soft **Add** pill. Adding never switches: the row moves up into Your servers and a toast offers "Switch".
- **Switch curtain** (`features/connection/curtain.tsx`): the seam when switching Hermes. The old Hermes blurs away behind frosted glass, the breathing mark says "Switching to VPS…", the app reloads beneath, and the glass clears onto the new Hermes. Under reduced motion it is a plain 150ms fade.

## Legacy names

The agent avatar used to be called the Orb. A few names in code still say so; leave them be, and use Buddy everywhere else, docs included.

- `src/ui/orb.tsx` re-exports `Buddy` and `BuddyStack` as `Orb` and `OrbStack` (and `BuddyState` as `OrbState`) so older screens keep working; new code imports from `@/ui/buddy`. The `data-orb` attribute is the marker that `src/lib/transitions.ts` looks for on a screen's main face (and `data-orb="brand"` on the header mark).

## Voice

Short, warm, sentence case. Errors say what happened and what to do: "Can’t reach Hermes. Check that it’s running, then try again." There are no exclamation marks except in a genuine celebration, and no emoji in UI chrome.
