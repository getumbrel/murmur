import { useEffect, useState } from 'react'
import { Page } from '@/features/settings/page'
import { HermesSection } from '@/features/settings/hermes-section'
import { AskHost } from '@/features/settings/ask'
import { useSwitchCurtain, type ConnectionRequest, type HermesConnection } from '@/state/connection'
import { HermesConnectionForm, HermesConnectionFormView, ManagedHermes } from './hermes-connection-form'
import { LoginScreen } from './login'
import { HermesSwitcher } from './switcher'
import { SwitchCurtain } from './curtain'

// Dev playground for the connection pieces, at /connection.html?view=…
//   form · form-needs-login · form-bad-login · form-unreachable · form-connected
//   settings · managed · managed-down · managed-env · login · login-error · live
//   switcher (the pill and Settings → Server, on the real server) · curtain
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

export function ConnectionPlayground() {
  const [loginError, setLoginError] = useState<string | null>(view === 'login-error' ? 'That password didn’t work.' : null)

  if (view === 'live') return <HermesConnectionForm />
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
      view === 'managed-down'
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
            <ManagedHermes connection={managed} />
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
