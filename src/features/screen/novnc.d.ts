// noVNC 1.7 ships no types. What Murmur uses of it, including the private
// pieces it needs to reshape the screen for a phone (setDesktopSize), to
// follow the screen's size (_resize), to measure its own box (_screenSize)
// and to let go of the keys it holds down on the screen (_keyboard).
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean })
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    showDotCursor: boolean
    background: string
    qualityLevel: number
    compressionLevel: number
    disconnect(): void
    sendKey(keysym: number, code: string | null, down?: boolean): void
    focus(options?: FocusOptions): void
    blur(): void
    clipboardPasteFrom(text: string): void
    static messages: { setDesktopSize(sock: unknown, w: number, h: number, id: number, flags: number): void }
    _sock: unknown
    _screenID: number
    _screenFlags: number
    _fbWidth: number
    _fbHeight: number
    _screen: HTMLElement
    _keyboard: { _allKeysUp(): void }
    _resize(width: number, height: number): void
    _screenSize(): { w: number; h: number }
  }
}
