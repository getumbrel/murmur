import { ios } from '@/lib/device'

/**
 * Hands the person a file to keep: into Downloads from a browser, through
 * the Save panel in the desktop app. An iPhone has no Downloads for a web
 * app to save into, so there it's the share sheet, which has Save to Files.
 * False if it couldn't be handed over.
 */
export async function saveFile(name: string, text: string, type = 'text/markdown') {
  const file = new File([text], name, { type })
  if (ios && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return true
    } catch (e) {
      // Closing the sheet is an answer too.
      return e instanceof DOMException && e.name === 'AbortError'
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // (Once the browser has had time to start reading it.)
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return true
}
