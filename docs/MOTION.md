# Murmur motion

Motion in Murmur is how the app shows it's alive. Agents have presence, the interface responds the instant you touch it, and nothing moves without a reason. Aim for the feel of iOS and Dynamic Island, not a demo reel.

## Laws

1. **Respond within 100ms.** Every press gives immediate feedback: `scale(.97)` on `:active`, or a fill change.
2. **Entering or leaving: ease-out. Moving on screen: ease-in-out or a spring. Hover: `ease`, ≤150ms, and only for `(hover:hover) and (pointer:fine)`.** Never use ease-in, and never use linear except for spinners and shimmer.
3. **Keep UI under 300ms.** Sheets take 260–320ms (springs), content entrances 380–460ms, and exits are about 20% faster than entrances.
4. **Animate only `transform` and `opacity`.** Use the `filter: blur()` mask under 12px, and only on small elements. Never animate height on long lists. To grow a single block, use `AnimatedHeight`-style measured springs.
5. **Nothing appears from nothing.** Start from `scale(.95–.97)` with opacity 0 and a small y offset (6–12px), never from `scale(0)`. Set `transform-origin` to the element's source, such as the button that opened it or the composer for a sent bubble.
6. **Springs carry intent.** Make gestures and anything interruptible a spring:
   - Default: `{type:'spring', duration:.35, bounce:0}`.
   - Playful moments like a buddy, a creation or a success: `bounce .15–.25`.
   - Drag release: inherit velocity.
7. **Animate rare moments richly and frequent ones barely.** Onboarding, creating an agent and the first message deserve choreography. Typing, sending and scrolling must be instant and quiet.
8. **Paired elements share timing.** A sheet and its scrim, or a card and its receipt, use the same curve and duration.
9. **Reduced motion is designed, not deleted.** Under `prefers-reduced-motion`, swap movement for a short crossfade (≤150ms) or no animation. Keep state legible without motion: a buddy's state must also show through eyes, colour or label.
10. **Use the main thread sparingly.** Streaming must never re-render the whole thread. Prefer CSS keyframes for repeating loops (buddies, shimmer), and use `motion` for layout and gestures.

## Curves (`src/styles.css`)

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | Entrances, reveals |
| `--ease-sheet` | `cubic-bezier(.32,.72,0,1)` | Sheets, pushes, layout morphs |
| `--ease-spring` | `cubic-bezier(.34,1.4,.64,1)` | Small overshoots: toggles, badges |

## Signature moments

- **Murmuration (welcome).** The hero. Dots never simply become buddies: the flock *makes* them. The whole sequence runs on one clock in one rAF loop (`features/onboarding/murmuration.ts`), drawing the canvas and setting the mark's transform and opacity directly, with no React renders. It pauses with the tab, and a tap anywhere settles it.
  - **0–0.74s, flock.** A rippling sheet of dots turns in 3D, violet on one wing and coral on the other, and fades in over 450ms.
  - **0.74–1.56s, spiral home.** Each wing curls in on its own side, mirrored, and every bird takes a seat inside its buddy's silhouette. The leading edge goes first, the last bird 240ms later. The silhouettes are read off the live mark's own paths, so they can't drift from it. The buddies form 10% of the mark's height apart and at 86% size, and each dot warms from its wing's colour into the buddy's own gradient as it lands. For a beat they read as dotted buddies.
  - **1.48–1.78s, swell.** The dots grow from the middle out until they run together. Clipped to each silhouette, they reveal that buddy as the mark draws it, lit and with its eyes shut. The bodies plump up to full size on a spring (ζ .42), so the inflate overshoots a touch.
  - **1.66–1.9s, meet.** They lean back a hair, then fall in toward each other with a 4px hop, tipping in about 4°. They straighten as they bump, then squash into the floor together (9%, then a struck spring, ζ .3).
  - **1.92–2.08s, hand-over.** The live mark fades in over the canvas mid-wobble, squashing from the same point, the middle of their feet. The only visible change is the seam where violet melts into coral, and their shadow landing.
  - **2.16s, wake.** The eyes open from shut (scaleY .1 → 1.14 → 1, 340ms), coral 90ms after violet. Each blinks once about a second later, then they fall back into their own rhythms, and the breath starts from rest.
  - **2.26s, words.** The title, then the line, then Get started rise in.
  - **Cost.** Under 2ms of script a frame at 4× CPU throttle, with no dropped frames. Each buddy's portrait is painted to a bitmap once, so the volume filter never re-runs.
  - **Reduced motion, or coming back:** everything is in place from the first frame, still, with no blink.
- **Splash.** The bare mark rises in (breathing, blinking) when loading is slow. When the app is ready it settles into the header's mark (the home large title on phones, the sidebar lockup on wide screens), or dissolves where there's none.
- **Buddy flight.** An agent's buddy is one thing that travels: from its roster row (or its card in All agents) to its page's hero, into the chat header, and back the same way. It uses the View Transitions API (`src/lib/transitions.ts`): the face being left gets `view-transition-name: buddy`, the update runs, and the face being arrived at takes the name, so one name morphs between the two. A group's buddies fly together as one. The page itself pushes in iOS-style: the new page slides in from the right at 100%→0 over 320ms with `--ease-sheet`, and the old page drifts left by -25% and dims. On wide screens the sidebar stays put, the main pane crossfades and the buddy doesn't fly. Under reduced motion every change is a 150ms crossfade; where View Transitions aren't supported, it's an instant change.
- **The agent pays attention.** The header buddy has a `listening` state: while you type, its eyes glance down toward the composer. When you send, it blinks once and goes to `thinking`. When the reply streams, it settles back to `idle`.
- **Send.** Your bubble pops out of the composer: transform-origin bottom-right, `scale(.94)` with y 10 → 0, over 380ms. The composer clears with no motion. The thread scrolls to the bottom with a spring.
- **Streaming text.** Text fades in word by word: about 120ms opacity with y 2px, through streamdown's `animated`/`isAnimating`, or a CSS class on new spans. A soft caret in the agent's hue breathes at the end while streaming.
- **Steps.** Each new step rises in (opacity plus y 6, 240ms). The running icon shows a tiny spinner ring that morphs into a check (stroke-draw 220ms). "Worked for 12s" expands and collapses with a measured spring.
- **Approval.** The card arrives with a spring (`scale(.97)` → 1, y 8, bounce .15) and the speaker's buddy starts its warm `waiting` pulse. After Allow, the card's height springs down into a one-line receipt with a brief success tint (300ms). After Don't allow, it settles neutrally.
- **Creating an agent.** On Create, the preview buddy plays its `done` happy bounce, the sheet closes, and the new row springs into the roster (layout spring) with a one-time soft halo ring burst. The app then opens the agent's chat through the buddy flight.
- **Roster life.** Rows reorder with a layout spring when activity changes. "Needs you" cards slide down from under the title. A working agent's subtitle crossfades as it moves between steps.
- **Group chat.** The header stands the members side by side (`BuddyRow`). When an agent takes the floor, its buddy springs to 1.12 and takes `speaking`, the others relax to 0.92 and lean and look toward it, and the speaker label crossfades. When @mentions are typed, each newly mentioned buddy hops.
- **Switching Hermes.** The old Hermes blurs away behind frosted glass (240ms in), the breathing mark rises in (`scale(.94)`, y 6, 420ms) with "Switching to VPS…" hanging under it, the app reloads beneath, and the glass clears (400ms) onto the new Hermes. The mark sits exactly where the splash puts its own, so if the splash is still up when the glass clears, one hands straight to the other. Reduced motion: 150ms fades only.
- **Gathering ("Your agents are here").** A rare moment, choreographed richly. Each agent's buddy starts on a loose ring around the row (150–220px out, seeded from its id so it's the same every time) at `scale(.7)`, transparent and blurred 4px, and springs to its place (`duration .8, bounce .25`), others first, outermost soonest, 90ms apart; the main agent lands last, in the middle. Each takes `done` as it lands, then `idle`. With the last landing a Bloom ripples behind the row, the glow grows in, and the words rise after it. Under 1.9s; a tap anywhere settles it. Reduced motion: everyone in place, `done` eyes then `idle`.
- **Getting ready.** Arriving from the "Built into Murmur" card, its 64px buddy flies to the 104px hero (a spring, `duration .5, bounce .15`, carried across a reload when there is one); from the smaller Start fresh row the hero rises in instead. Each step's tick draws its stroke in 220ms; labels crossfade in 150ms. When Murmur is in, the buddy takes `done` over a Bloom, the title becomes "All set", and the app takes over 900ms later. The faces on a found Hermes's card hop in one by one (60ms apart) as a small preview of the Gathering; an out-of-date one's faces sleep, and wake with a hop when it's been updated.
- **Connection pill.** A Dynamic Island-style pill appears at the top, springing from a small capsule into its full width. It collapses the same way, with a brief "Connected" tick.
- **Model chip.** When the model or thinking level changes, its label morphs: the old text slides up and fades while the new text slides in from below, over 200ms.
- **Haptics.** On Android only (`navigator.vibrate`), give a light 8–12ms tick on send, Allow and creating an agent. Never buzz on streaming.

## Things that must not move

- Scrolling and the composer textarea itself.
- Message text that's already rendered.
- The background.
- Anything triggered by the keyboard: shortcuts swap instantly.
