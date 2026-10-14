// The application menu and the right-click menu.

import { app, clipboard, Menu, shell, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions as Item } from 'electron'

const WEBSITE = 'https://umbrel.com/murmur'
const REPO = 'https://github.com/getumbrel/murmur'

const isMac = process.platform === 'darwin'

export type Updates = {
  /** Shown only when this build updates itself. */
  check?: () => void
  /** A downloaded update's version, waiting for a restart. */
  ready?: string
  restart?: () => void
}

export function setMenu(updates: Updates = {}) {
  const dev = !app.isPackaged
  const updateItems: Item[] = updates.ready
    ? [{ label: `Restart to Update to ${updates.ready}`, click: updates.restart }]
    : updates.check
      ? [{ label: 'Check for Updates…', click: updates.check }]
      : []

  const template: Item[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `About ${app.name}` },
              ...updateItems,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: `Hide ${app.name}` },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: `Quit ${app.name}` },
            ],
          } as Item,
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close', label: 'Close Window' } : { role: 'quit', label: 'Quit Murmur' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? ([
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
            ] as Item[])
          : ([{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }] as Item[])),
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(dev
          ? ([{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as Item[])
          : []),
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([{ type: 'separator' }, { role: 'front', label: 'Bring All to Front' }] as Item[])
          : ([{ role: 'close', label: 'Close Window' }] as Item[])),
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Murmur Website', click: () => void shell.openExternal(WEBSITE) },
        { label: 'Murmur on GitHub', click: () => void shell.openExternal(REPO) },
        { label: 'Report a Problem…', click: () => void shell.openExternal(`${REPO}/issues`) },
        ...(isMac ? [] : ([{ type: 'separator' }, ...updateItems, { role: 'about', label: 'About Murmur' }] as Item[])),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Electron shows no menu on right-click by itself: spelling, the clipboard, links and images. */
export function contextMenu(window: BrowserWindow, params: ContextMenuParams) {
  const contents = window.webContents
  const { editFlags, isEditable, selectionText, linkURL, mediaType, srcURL, misspelledWord, dictionarySuggestions } = params
  const hasText = selectionText.trim().length > 0
  const sections: Item[][] = []

  if (misspelledWord) {
    sections.push([
      ...(dictionarySuggestions.length
        ? dictionarySuggestions.slice(0, 5).map((word) => ({ label: word, click: () => contents.replaceMisspelling(word) }))
        : [{ label: 'No Guesses Found', enabled: false }]),
      { label: 'Learn Spelling', click: () => contents.session.addWordToSpellCheckerDictionary(misspelledWord) },
    ])
  }
  if (isMac && hasText && !isEditable) {
    const word = selectionText.trim().length > 24 ? `${selectionText.trim().slice(0, 24)}…` : selectionText.trim()
    sections.push([{ label: `Look Up “${word}”`, click: () => contents.showDefinitionForSelection() }])
  }
  if (linkURL && /^(https?|mailto):/i.test(linkURL)) {
    sections.push([
      { label: 'Open Link in Browser', click: () => void shell.openExternal(linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(linkURL) },
    ])
  }
  if (mediaType === 'image' && srcURL) {
    sections.push([{ label: 'Copy Image', click: () => contents.copyImageAt(params.x, params.y) }])
  }
  if (isEditable) {
    sections.push([
      { role: 'cut', enabled: editFlags.canCut && hasText },
      { role: 'copy', enabled: editFlags.canCopy && hasText },
      { role: 'paste', enabled: editFlags.canPaste },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ])
  } else if (hasText) {
    sections.push([{ role: 'copy' }])
  }
  if (!app.isPackaged) sections.push([{ label: 'Inspect Element', click: () => contents.inspectElement(params.x, params.y) }])

  const items = sections.flatMap((section, i) => (i ? [{ type: 'separator' } as const, ...section] : section))
  if (items.length) Menu.buildFromTemplate(items).popup({ window })
}
