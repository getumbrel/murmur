import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Paperclip } from 'lucide-react'

/**
 * Drop files anywhere on the chat. While something is dragged over the
 * window, the chat softens under a quiet target; letting go hands the files to
 * the composer's tray.
 */
export function DropZone({
  onFiles,
  label,
  disabled,
}: {
  onFiles: (files: File[]) => void
  label: string
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const latest = useRef(onFiles)
  latest.current = onFiles

  useEffect(() => {
    if (disabled) return
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    }
    const overWin = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      depth.current = 0
      setOver(false)
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) latest.current(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overWin)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overWin)
      window.removeEventListener('drop', drop)
    }
  }, [disabled])

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
            className="flex flex-col items-center gap-3 rounded-2xl bg-elevated px-10 py-8 text-center shadow-float ring-[0.5px] ring-line-strong"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Paperclip size={22} strokeWidth={1.9} />
            </span>
            <p className="text-subhead font-semibold tracking-[-0.01em]">{label}</p>
            <p className="-mt-2 text-footnote text-ink-2">Photos and files up to 25 MB</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
