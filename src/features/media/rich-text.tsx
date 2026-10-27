import { lazy, memo, Suspense, useMemo } from 'react'
import { Markdown } from '@/features/chat/lazy-markdown'
import { MediaBlock } from './blocks'
import { splitMessage } from '@shared/message.ts'
import './media.css'

const PreviewFrame = lazy(() => import('./preview-frame').then((m) => ({ default: m.PreviewFrame })))

/**
 * An assistant reply: prose as markdown, with the files and widgets it
 * delivers (MEDIA:, ::preview) rendered in place.
 */
export const RichText = memo(function RichText({ text, streaming }: { text: string; streaming?: boolean }) {
  const segments = useMemo(() => splitMessage(text, streaming), [text, streaming])
  if (segments.length === 1 && segments[0].kind === 'md')
    return <Markdown text={segments[0].text} streaming={streaming} />
  return (
    <div className="flex flex-col gap-3">
      {segments.map((s, i) => {
        const last = i === segments.length - 1
        switch (s.kind) {
          case 'md':
            return <Markdown key={i} text={s.text} streaming={streaming && last} />
          case 'media':
            return <MediaBlock key={i} path={s.path} />
          case 'preview':
            return (
              <Suspense key={i} fallback={<div className="media-skeleton h-44 rounded-md" />}>
                <PreviewFrame file={s.file} />
              </Suspense>
            )
        }
      })}
    </div>
  )
})
