import { lazyComponent } from '@/lib/lazy'

/**
 * Markdown, loaded beside the main bundle: its parser is a third of the app's
 * weight. It starts loading as soon as the app does, so by the time a chat is
 * on screen it renders at once; until then, the words as plain text.
 */
export const Markdown = lazyComponent(
  () => import('./markdown').then((m) => m.Markdown),
  ({ text }) => <p className="md whitespace-pre-wrap">{text}</p>,
)
