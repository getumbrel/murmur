import {
  AppWindow,
  AudioLines,
  Blocks,
  BookOpen,
  Bookmark,
  Braces,
  CalendarClock,
  Eye,
  FileText,
  Globe,
  History,
  ImagePlus,
  ListChecks,
  Mail,
  MessageCircleQuestion,
  Send,
  SquareTerminal,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ToolCategory } from './tool-labels'

const ICONS: Record<ToolCategory, LucideIcon> = {
  web: Globe,
  browser: AppWindow,
  terminal: SquareTerminal,
  file: FileText,
  code: Braces,
  helper: Users,
  memory: Bookmark,
  playbook: BookOpen,
  plan: ListChecks,
  vision: Eye,
  image: ImagePlus,
  voice: AudioLines,
  message: Send,
  schedule: CalendarClock,
  question: MessageCircleQuestion,
  history: History,
  mail: Mail,
  app: Blocks,
  other: Wrench,
}

export function ToolIcon({ category, size = 14 }: { category: ToolCategory; size?: number }) {
  const Icon = ICONS[category]
  return <Icon size={size} strokeWidth={1.75} aria-hidden />
}
