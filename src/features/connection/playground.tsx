import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { Page } from '@/features/settings/page'
import { HermesSection } from '@/features/settings/hermes-section'
import { AskHost } from '@/features/settings/ask'
import { useSwitchCurtain, type ConnectionRequest, type HermesConnection, type KnownHermes } from '@/state/connection'
import type { FoundHermes, Setup } from '@/state/setup'
import { NoHermesSheet } from './no-hermes'
import { UpdateHermes } from './update-hermes'
import { HermesConnectionForm, HermesConnectionFormView, ManagedHermes } from './hermes-connection-form'
import { LoginScreen } from './login'
import { HermesSwitcher } from './switcher'
import { SwitchCurtain } from './curtain'

// Dev playground for the connection pieces, at /connection.html?view=…
//   form · form-needs-login · form-bad-login · form-unreachable · form-connected
//   settings · managed · managed-down · managed-env · login · login-error · live
//   switcher (the pill and Settings → Server, on the real server) · curtain
//   Settings → Server with a built-in, on a fake server (Add works):
//     server-builtin · server-both · server-upgrade · server-starting · server-nearby
//   managed-builtin · managed-builtin-starting · managed-builtin-down · update-builtin · no-hermes
// Fake answers: any address containing "gated" needs murmur / hunter2;
// "nope" is unreachable; "example" isn't Hermes.

const view = new URLSearchParams(location.search).get('view') ?? 'form'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const base = { managed: false, source: 'saved' as const, hermesVersion: '0.21.5' }

async function fake(req: ConnectionRequest): Promise<HermesConnection> {
  await wait(700)
  const url = req.url.startsWith('http') ? req.url : `http://${req.url}`
  if (url.includes('nope')) return { ...base, url, mode: 'unknown', status: 'unreachable', hermesVersion: undefined, error: 'Couldn’t reach that address. Check that Hermes is running and the address is right.' }
  if (url.includes('example')) return { ...base, url, mode: 'unknown', status: 'unreachable', hermesVersion: undefined, error: 'That doesn’t look like a Hermes dashboard.' }
  if (url.includes('gated')) {
    if (!req.username) return { ...base, url, mode: 'password', status: 'needs-login', error: 'This Hermes needs a username and password.' }
    if (req.username !== 'murmur' || req.password !== 'hunter2') return { ...base, url, mode: 'password', status: 'bad-login', username: req.username, error: 'That username or password didn’t work.' }
    return { ...base, url, mode: 'password', status: 'connected', username: req.username }
  }
  return { ...base, url, mode: 'token', status: 'connected' }
}

const gated = 'http://192.168.1.20:9119'

const presets: Record<string, Parameters<typeof HermesConnectionFormView>[0]['initial']> = {
  'form-needs-login': {
    url: gated,
    showAuth: true,
    result: { ...base, url: gated, mode: 'password', status: 'needs-login', error: 'This Hermes needs a username and password.' },
  },
  'form-bad-login': {
    url: gated,
    username: 'murmur',
    password: 'wrong-password',
    showAuth: true,
    result: { ...base, url: gated, mode: 'password', status: 'bad-login', error: 'That username or password didn’t work.' },
  },
  'form-unreachable': {
    url: '192.168.1.21:9119',
    result: { ...base, url: 'http://192.168.1.21:9119', mode: 'unknown', status: 'unreachable', hermesVersion: undefined, error: 'Couldn’t reach that address. Check that Hermes is running and the address is right.' },
  },
  'form-connected': {
    url: gated,
    username: 'murmur',
    showAuth: true,
    phase: 'connected',
    result: { ...base, url: gated, mode: 'password', status: 'connected', username: 'murmur' },
  },
}

const savedConnection: HermesConnection = { ...base, url: 'https://hermes.example.net', mode: 'password', status: 'connected', username: 'murmur' }

// ── A fake Murmur server for Settings → Server ─────────────────────────────

const builtin: KnownHermes = { id: 'builtin', name: 'Built-in', url: 'http://murmur_hermes_1:9119', managed: true, source: 'builtin', mode: 'password', status: 'connected', hermesVersion: '0.22.0' }
const agentApp: KnownHermes = { id: 'main', name: 'Hermes Agent', url: 'http://hermes-agent_web_1:18789', managed: false, source: 'saved', mode: 'token', status: 'connected', hermesVersion: '0.22.0' }
const PEOPLE = [
  { id: 'default', name: 'Juniper', hue: 278, isDefault: true },
  { id: 'sage', name: 'Sage', hue: 160 },
  { id: 'otto', name: 'Otto', hue: 52 },
]
const foundApp: FoundHermes = { id: 'f-umbrel', name: 'Hermes Agent', where: 'umbrel', url: agentApp.url, host: 'hermes-agent_web_1:18789', version: '0.22.0', agents: PEOPLE, agentCount: 6, chats: 140, hasModel: true }

const SERVERS: Record<string, { list: KnownHermes[]; setup: Setup }> = {
  'server-builtin': { list: [builtin], setup: { decided: true, umbrel: true, builtin: { state: 'ready', added: true }, found: [foundApp] } },
  'server-both': { list: [builtin, agentApp], setup: { decided: true, umbrel: true, builtin: { state: 'ready', added: true }, found: [] } },
  'server-upgrade': { list: [agentApp], setup: { decided: true, umbrel: true, builtin: { state: 'ready', added: false }, found: [] } },
  'server-starting': {
    list: [{ ...builtin, status: 'unreachable', hermesVersion: undefined }, agentApp],
    setup: { decided: true, umbrel: true, builtin: { state: 'starting', added: true }, found: [] },
  },
  'server-nearby': {
    list: [builtin],
    setup: {
      decided: true,
      umbrel: false,
      builtin: { state: 'ready', added: true },
      found: [
        { ...foundApp, id: 'f-old', name: 'Hermes on this computer', where: 'computer', url: 'http://localhost:9119', host: 'localhost:9119', outdated: true, version: '0.20.1' },
        { id: 'f-studio', name: 'Hermes on studio.local', where: 'network', url: 'http://studio.local:9119', host: 'studio.local:9119', version: '0.22.0', needsSignIn: true },
      ],
    },
  },
}

/** Answers the few /murmur calls Settings → Server makes, from the fixture above. */
function fakeServer(key: string) {
  const state = { ...SERVERS[key], list: [...SERVERS[key].list] }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    const method = init?.method ?? 'GET'
    const list = () => ({ active: state.list[0].id, connections: state.list })
    if (url.startsWith('/murmur/setup')) return json(state.setup)
    if (url === '/murmur/connections' && method === 'GET') return json(list())
    if (url === '/murmur/connection' && method === 'GET') return json(state.list[0])
    if (url === '/murmur/connections' && method === 'POST') {
      await wait(900)
      const body = JSON.parse(String(init?.body ?? '{}')) as { found?: string; builtin?: boolean }
      const added = body.builtin ? builtin : { ...agentApp, id: 'x' + state.list.length }
      state.list.push(added)
      state.setup = { ...state.setup, found: state.setup.found.filter((f) => f.id !== body.found), builtin: state.setup.builtin && { ...state.setup.builtin, added: true } }
      return json({ connection: added, ...list() })
    }
    return real(input, init)
  }
}

if (view.startsWith('server-')) fakeServer(view)

export function ConnectionPlayground() {
  const [loginError, setLoginError] = useState<string | null>(view === 'login-error' ? 'That password didn’t work.' : null)

  if (view === 'live') return <HermesConnectionForm />
  if (view.startsWith('server-')) {
    return (
      <>
        <Page title="Server" back={{ label: 'Settings', onClick: () => {} }}>
          <HermesSection />
        </Page>
        <AskHost />
        <Toaster position="top-center" toastOptions={{ className: 'murmur-toast' }} />
      </>
    )
  }
  if (view === 'update-builtin') {
    return <UpdateHermes connection={{ ...builtin, outdated: true, hermesVersion: '0.21.2', minVersion: '0.21.4' }} onCheck={() => wait(800)} />
  }
  if (view === 'no-hermes') return <NoHermesSheet open onOpenChange={() => {}} />
  if (view === 'switcher') return <SwitcherPreview />
  if (view === 'curtain') return <CurtainPreview />
  if (view === 'login' || view === 'login-error') {
    return (
      <LoginScreen
        error={loginError}
        onEdit={() => setLoginError(null)}
        onSubmit={async (pw) => {
          await wait(600)
          if (pw === 'hunter2') return true
          setLoginError('That password didn’t work.')
          return false
        }}
        onSignedIn={() => alert('Signed in')}
      />
    )
  }
  if (view === 'settings' || view.startsWith('managed')) {
    const managed: HermesConnection =
      view === 'managed-builtin'
        ? builtin
        : view === 'managed-builtin-starting' || view === 'managed-builtin-down'
          ? { ...builtin, status: 'unreachable', hermesVersion: undefined }
          : view === 'managed-down'
        ? { url: 'http://hermes-agent_web_1:18789', managed: true, source: 'env', mode: 'unknown', status: 'unreachable', error: 'Couldn’t reach that address.' }
        : view === 'managed-env'
          ? { url: 'http://10.0.0.5:9119', managed: true, source: 'env', mode: 'token', status: 'connected', hermesVersion: '0.21.5' }
          : { url: 'http://hermes-agent_web_1:18789', managed: true, source: 'env', mode: 'token', status: 'connected', hermesVersion: '0.21.5' }
    return (
      <Page title="Server" back={{ label: 'Settings', onClick: () => {} }}>
        <div>
          {view === 'settings' ? (
            <>
              <HermesConnectionFormView embedded current={savedConnection} onTest={fake} onSave={fake} onReset={() => {}} />
              <AskHost />
            </>
          ) : (
            <ManagedHermes connection={managed} starting={view === 'managed-builtin-starting'} />
          )}
        </div>
      </Page>
    )
  }
  return <HermesConnectionFormView key={view} initial={presets[view]} onTest={fake} onSave={fake} onConnected={() => {}} />
}

/** The pill as a header would carry it, over Settings → Server, both live. */
function SwitcherPreview() {
  return (
    <>
      <div className="mx-auto max-w-[40rem] px-5 pt-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-large font-semibold tracking-[-0.02em]">Chats</h1>
          <HermesSwitcher />
        </div>
      </div>
      <Page title="Server">
        <HermesSection />
      </Page>
      <AskHost />
      <SwitchCurtain />
    </>
  )
}

function CurtainPreview() {
  useEffect(() => useSwitchCurtain.setState({ curtain: { name: 'VPS Hermes', at: Date.now(), arriving: false } }), [])
  return (
    <>
      <Page title="Server">
        <HermesSection />
      </Page>
      <AskHost />
      <SwitchCurtain />
    </>
  )
}
