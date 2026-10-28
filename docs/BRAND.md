# Murmur brand

## Story

A *murmur* is a quiet conversation. A *murmuration* is thousands of starlings moving as one. Murmur is where you talk with your agents: alone with one, or with a few of them together.

The mark is two buddies, violet and coral, leaning shoulder to shoulder until they spell a lowercase **m**. It's the product in one picture: little characters with their own colours who get on with things together, and lean in when you talk.

Every agent in the app is a buddy (`src/ui/buddy.tsx`). The mark is the first two of them.

## Colour

| Name | OKLCH | Hex | Role |
|---|---|---|---|
| Violet | `oklch(0.658 0.18 296)` | `#9D75F1` | The left buddy. Brand primary. |
| Coral | `oklch(0.764 0.136 21)` | `#FD8D8C` | The right buddy. Warmth. |
| Cream | `oklch(0.985 0.018 93)` | `#FEFAED` | The icon's ground. Marketing paper. |
| Ink | `oklch(0.2 0.025 305)` | `#1D1626` | Wordmark, the buddies' eyes, type on cream. |
| Night | `oklch(0.18 0.018 305)` | `#15111B` | The dark icon's ground. |

These are exported as `BRAND` from `src/ui/brand.tsx`.

**Brand colours and agent hues.**
- Each agent owns a hue from `src/lib/hues.ts`. Its buddy is lit with the same OKLCH recipe as the mark, so every agent looks like family.
- The brand pair sits next to two of those hues: violet is close to 278, the default agent, and coral is close to 28. The brand violet is pushed slightly redder (296) so it sits warmly beside coral.
- The pair is reserved for the mark. Don't use the violet-to-coral blend as a UI gradient or a background. Inside the app, colour belongs to the agents.

## The mark

All of these come from `src/ui/brand.tsx`.

| Variant | Use |
|---|---|
| `<MurmurMark tile />` | The full app-icon tile on cream. Use `theme="dark"` for the Night tile. |
| `<MurmurMark />` | The bare mark, for headers, footers and the about screen. Its `size` is its height; its width is about 1.43× that. |
| `<MurmurMark variant="glyph" />` | Flat and bold with a square crop, for favicons and anything under 24px. Eyes are dropped below 24px. |
| `<MurmurMark variant="mono" />` | One ink, in `currentColor`, for one-colour print, pinned tabs and embossing. A hairline parts the two buddies and the eyes are knocked out. |

- **Motion.** The two buddies blink at different, never-synchronised rhythms. `still` turns blinking off, and blinking always stops under reduced motion.
- **Clear space.** Leave a quarter of the mark's height free on every side.
- **Minimum sizes:**
  - Colour mark: 24px tall.
  - App tile: 29px.
  - Glyph: 16px.
  - Mono: 12px.

**Do**
- Put the colour mark on cream, white, Night or a quiet photo.
- Let the tile carry its own background.

**Don't**
- Recolour a buddy, swap their sides, or separate them.
- Add a third buddy. Groups in the app can, the mark can't.
- Outline, rotate, stretch or add effects.
- Set the colour mark on violet or coral; use mono there.

## Wordmark and lockup

`<MurmurWordmark size={28} />` sets the mark followed by **murmur**.

- **Lowercase.** It echoes the lowercase m of the monogram and feels approachable. In running text, the product name is always "Murmur".
- **Typeface: Inter, weight 600.** Inter is the UI face, so the brand and the product feel continuous. At 600 the type is plump enough to sit beside the soft buddies and still crisp at 14px.
- **Tracking: −0.042em.** Display-tight spacing stands in for Inter's optical-size axis. The app loads the weight-only cut, and loading the opsz cut would change every font in the app.
- **Proportion.** Type size is 0.94× the mark's height. The word's baseline sits on the buddies' feet.
- **No custom m.** We considered drawing a buddy-shaped m inside the word and decided against it: the mark already is that m, and two of them side by side would compete.

## Endorsement

`<ByUmbrel />` renders "**Murmur** by Umbrel".
- It's a 12px caption in `ink-3`, with Murmur in semibold `ink-2`.
- "Murmur" links to its source on GitHub and "Umbrel" to https://umbrel.com (new tab, `rel=noopener`). Each gets an underline on hover.
- Use it in About, Settings footers and onboarding's last screen. It should be legible, never louder than Murmur, and never in the main navigation.
- `mark` adds the 16px glyph in front (the colour mark would be under its 24px minimum).
- `<MurmurVersion />` is the version ("v0.8.1"), a quieter caption in `ink-3` that opens its release notes. It sits across from the signature at the foot of the sidebar.

## Voice

Murmur speaks calm, warm and plain.
- Use sentence case and short sentences.
- No jargon: say "Agent", "Chat" and "Group", never "session" or "toolset".
- No exclamation marks except in a real celebration, and no emoji in UI chrome.
- The buddies can be playful, so the words don't have to be.

See `docs/DESIGN.md` for the UI voice rules.

## Where things live

| Asset | Path |
|---|---|
| Mark, wordmark and endorsement components | `src/ui/brand.tsx`, `src/ui/brand.css` |
| Agent avatar (Buddy, BuddyStack, BuddyRow) | `src/ui/buddy.tsx`, `src/ui/buddy.css` |
| Master icon (1024 viewBox, full bleed, no corners, no text) | `design/icon/murmur-icon.svg` |
| Dark icon | `design/icon/murmur-icon-dark.svg` |
| Maskable icon (m inside the 80% safe zone) | `design/icon/murmur-icon-maskable.svg`, `-512.png` |
| Icon PNGs | `design/icon/murmur-icon-{1024,512,192,180}.png` |
| Favicon (32 design, with eyes) | `design/icon/favicon.svg`, `favicon-32.png` |
| Favicon (16, no eyes) | `design/icon/favicon-16.svg`, `favicon-16.png` |
| One-colour mark | `design/icon/murmur-mono.svg` |
| Live review of everything | `/buddy.html`, Brand section |

The SVGs are the components' own output with motion stripped. The PNGs are rendered from those SVG files, which proves the files stand alone. To re-export, change `brand.tsx` first and export again; don't edit the SVGs by hand.
