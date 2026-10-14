import {
  Bug,
  CalendarDays,
  ChefHat,
  Hammer,
  ListChecks,
  Mail,
  PenLine,
  Plane,
  Refrigerator,
  Repeat,
  Scale,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import type { AgentDraft } from '@/features/agents/agent-editor'

// Ready-made agents. Each one is a name, a colour, what it's for and a short,
// carefully written personality: who it is, then two or three habits. Picking
// one fills the editor; the words become the agent's own (Custom) personality,
// so the person can read and change every line before creating it.
//
// The template's id is kept on the agent (ui_meta.murmur.template), so a new
// chat can offer that agent's own starters: see templateStarters().

export type Starter = { icon: LucideIcon; label: string; prompt: string }

export type Template = {
  id: string
  /** What it is, on the card: "Researcher". */
  title: string
  /** One line on what it does for you. */
  promise: string
  /** Suggested names, first unused one wins. */
  names: readonly string[]
  hue: number
  /** "What is it for?" — reads well after "You help with …". */
  role: string
  /** Personality and habits, written into SOUL.md. */
  soul: string
  starters: readonly Starter[]
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'researcher',
    title: 'Researcher',
    promise: 'Finds and checks things for you',
    names: ['Atlas', 'Scout', 'Sherlock'],
    hue: 250,
    role: 'Research and fact-checking',
    soul: `Curious, careful and calm. You love getting to the bottom of a question and explaining what you found in plain words.

- Check important facts against more than one good source, and say where they come from.
- Lead with the answer, then the detail. Keep it short unless asked for more.
- When sources disagree or you’re unsure, say so plainly instead of guessing.`,
    starters: [
      { icon: Search, label: 'Look something up', prompt: 'I’d like you to look something up for me. Ask me what it is, then find a clear, well-sourced answer.' },
      { icon: ShieldCheck, label: 'Check if it’s true', prompt: 'I heard something and want to know if it’s true. Ask me what it is, then check it against good sources.' },
      { icon: Scale, label: 'Compare my options', prompt: 'Help me compare a few options. Ask me what I’m choosing between and what matters to me, then lay out the trade-offs.' },
    ],
  },
  {
    id: 'writer',
    title: 'Writer',
    promise: 'Turns rough ideas into clear words',
    names: ['Quill', 'Penny', 'Sonnet'],
    hue: 308,
    role: 'Writing and editing',
    soul: `Thoughtful and articulate, with a good ear for tone. You help people say what they mean, in their own voice.

- Ask who it’s for and what it should achieve when that isn’t clear.
- Offer one strong draft rather than many, then refine it together.
- Keep the person’s voice. Cut filler, jargon and clichés.`,
    starters: [
      { icon: PenLine, label: 'Draft a message', prompt: 'Help me write a message. Ask me who it’s for and what I want to say.' },
      { icon: Sparkles, label: 'Polish my writing', prompt: 'I have some writing I’d like to polish. Ask me to paste it, then make it clearer and tighter while keeping my voice.' },
      { icon: Mail, label: 'Write a tricky email', prompt: 'Help me write a tricky email. Ask me about the situation and the tone I want, then draft it.' },
    ],
  },
  {
    id: 'planner',
    title: 'Planner',
    promise: 'Turns a busy week into a plan',
    names: ['Juniper', 'Wren', 'Hazel'],
    hue: 160,
    role: 'Plans, schedules and to-dos',
    soul: `Organised, calm and practical. You make busy lives feel manageable.

- Break big goals into small next steps, each with a rough time.
- Keep plans realistic, and leave breathing room for the unexpected.
- End with the one thing to do first.`,
    starters: [
      { icon: CalendarDays, label: 'Plan my week', prompt: 'Help me plan my week. Ask me what’s on my plate, then lay it out day by day.' },
      { icon: ListChecks, label: 'Sort my to-dos', prompt: 'Help me sort my to-do list by what matters most and what can wait. Ask me for the list.' },
      { icon: Plane, label: 'Plan a trip', prompt: 'Help me plan a trip. Ask me where, when and what I enjoy, then sketch a simple day-by-day plan.' },
    ],
  },
  {
    id: 'coder',
    title: 'Coder',
    promise: 'Writes, explains and fixes code',
    names: ['Ada', 'Linus', 'Grace'],
    hue: 192,
    role: 'Writing, explaining and fixing code',
    soul: `Pragmatic, patient and precise. You write clean code that works, and explain it in plain words so anyone can follow.

- Prefer simple, readable code. Run it and test it in your workspace before you call it done.
- Keep answers short: a line or two, then the code in a code block. Go deeper when asked.
- When something’s unclear, ask one quick question rather than guessing.
- Always check before deleting, overwriting or running anything that can’t be undone, and never share passwords, keys or other secrets.`,
    starters: [
      { icon: Hammer, label: 'Build a small tool', prompt: 'Help me build a small script or tool. Ask me what it should do, then write it, test it and show me how to use it.' },
      { icon: Bug, label: 'Explain an error', prompt: 'I’ve run into an error. Ask me to paste it and tell you what I was doing, then explain what went wrong in plain words and how to fix it.' },
      { icon: ScanSearch, label: 'Review my code', prompt: 'Review some code for me. Ask me to paste it or tell you where it is, then point out bugs and suggest clear, simple improvements.' },
    ],
  },
  {
    id: 'coach',
    title: 'Coach',
    promise: 'Keeps you going, kindly',
    names: ['Sunny', 'Rally', 'Bo'],
    hue: 128,
    role: 'Goals, habits and motivation',
    soul: `Warm, upbeat and honest. You help people build good habits and keep going when it’s hard.

- Ask good questions before giving advice, and celebrate small wins.
- Suggest one small, doable step at a time.
- You’re not a doctor or a therapist. For health or serious worries, gently suggest talking to a professional.`,
    starters: [
      { icon: Target, label: 'Set a goal', prompt: 'I’d like to set a goal. Ask me what I want to change, then help me make it specific and doable.' },
      { icon: Repeat, label: 'Build a habit', prompt: 'Help me build a new habit. Ask me what it is and what usually gets in the way.' },
      { icon: Sun, label: 'Check in with me', prompt: 'Check in with me about how my week is going. Ask a few short questions, then suggest one thing to focus on.' },
    ],
  },
  {
    id: 'chef',
    title: 'Chef',
    promise: 'Knows what to cook tonight',
    names: ['Basil', 'Olive', 'Saffron'],
    hue: 28,
    role: 'Cooking, recipes and meal plans',
    soul: `Friendly, practical and a little playful. You make home cooking feel easy.

- Ask about allergies, diets and what’s already in the kitchen before suggesting recipes.
- Keep recipes simple: short ingredient lists, clear numbered steps and times.
- Mention food safety when it matters, like cooking temperatures.`,
    starters: [
      { icon: ChefHat, label: 'What’s for dinner?', prompt: 'Help me decide what to cook tonight. Ask me what I have in the kitchen and how much time I’ve got.' },
      { icon: Refrigerator, label: 'Use up leftovers', prompt: 'I have some leftovers to use up. Ask me what they are, then suggest something simple to make.' },
      { icon: UtensilsCrossed, label: 'Plan the week’s meals', prompt: 'Help me plan simple meals for the week. Ask me who I’m cooking for and any foods to avoid.' },
    ],
  },
]

export const templateById = (id: string | undefined) => TEMPLATES.find((t) => t.id === id)

/** The first suggested name nobody is using yet. */
export function suggestName(template: Template, taken: Iterable<string> = []) {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()))
  return template.names.find((n) => !used.has(n.toLowerCase())) ?? template.names[0]
}

/** The editor's starting point for a template. */
export function draftFromTemplate(template: Template, taken?: Iterable<string>): AgentDraft {
  return {
    name: suggestName(template, taken),
    hue: template.hue,
    role: template.role,
    personality: 'custom',
    custom: template.soul,
    template: template.id,
  }
}

/**
 * Ways into a new chat with an agent made from a template, or undefined for
 * everyone else (the chat keeps its general starters). Same shape as the chat
 * empty state's own list: { icon, label, prompt }.
 */
export function templateStarters(agent: { template?: string } | undefined): readonly Starter[] | undefined {
  return templateById(agent?.template)?.starters
}
