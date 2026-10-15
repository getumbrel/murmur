// Where an app sends the browser back after someone signs in to it for an
// agent (Notion, Linear…, Hermes's MCP catalog). Murmur points the sign-in
// here, at its own address, because the browser can't reach Hermes's; the
// relay hands the code to Hermes and answers with a page of its own, since
// Hermes's is a bare one (and Murmur never shows Hermes's markup).
//
// It's let through without Murmur's sign-in or the desktop app's header:
// it often arrives in another browser (the desktop app opens sign-ins in the
// person's own), and Hermes keeps it public too. The one-time state in the
// address is what proves it, and Hermes checks that.

import type http from 'node:http'

export const OAUTH_RETURN = '/hermes/api/mcp/oauth/callback/'

/** Exactly one app's return (callback/<name>, as Hermes's catalog names them), nothing deeper. */
const RETURN_PATH = /^\/hermes\/api\/mcp\/oauth\/callback\/[A-Za-z0-9][A-Za-z0-9._-]*$/

export const isOAuthReturn = (req: http.IncomingMessage, path: string) => req.method === 'GET' && RETURN_PATH.test(path)

const COPY = {
  ok: ['You’re signed in', 'Head back to Murmur.'],
  failed: ['That didn’t go through', 'Head back to Murmur and try again.'],
}

/** The page the sign-in tab lands on. It closes itself when it can; Murmur's own tab says the rest. */
export function returnPage(ok: boolean) {
  const [title, body] = ok ? COPY.ok : COPY.failed
  const mark = ok ? '<path d="M8 12.5l2.6 2.6L16 9.5" />' : '<path d="M12 7.5v5.5" /><path d="M12 16.4v.1" />'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>
  :root { --bg: #fbfaf8; --ink: #1d1626; --ink-2: #6f6878; --tint: ${ok ? '#34c759' : '#ff9f0a'}; }
  @media (prefers-color-scheme: dark) { :root { --bg: #15111b; --ink: #f4f1f7; --ink-2: #9a93a3; } }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 15px/1.45 -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { text-align: center; padding: 24px; animation: rise .42s cubic-bezier(.16,1,.3,1) both; }
  svg { width: 64px; height: 64px; display: block; margin: 0 auto 18px; }
  circle { fill: var(--tint); }
  path { fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -.02em; margin: 0 0 4px; }
  p { margin: 0; color: var(--ink-2); }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.97); } }
  @media (prefers-reduced-motion: reduce) { main { animation-duration: .15s; animation-name: fade; } @keyframes fade { from { opacity: 0; } } }
</style>
</head>
<body>
<main>
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" />${mark}</svg>
  <h1>${title}</h1>
  <p>${body}</p>
</main>
${ok ? '<script>setTimeout(() => window.close(), 900)</script>' : ''}
</body>
</html>
`
}

export function sendReturnPage(res: http.ServerResponse, ok: boolean) {
  const html = returnPage(ok)
  res.writeHead(ok ? 200 : 400, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    // Nothing loads from elsewhere, and the code in the address goes nowhere.
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  })
  res.end(html)
}
