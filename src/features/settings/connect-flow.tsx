import { useState } from 'react'
import { ConnectModel, type ConnectOption, type ConnectState, type LocalServer } from '@/features/onboarding/connect'
import {
  adoptChatGPT,
  connectApiKey,
  connectLocal,
  findServer,
  useChatGPTSignIn,
  useLocalServers,
  useRefreshModels,
  type Confirm,
} from '@/state/models'
import { useDeviceModels, useDeviceSetup, useFindModel } from '@/state/local-runtime'
import { useHermesConnection, type HermesConnection } from '@/state/connection'
import { isBuiltinHermes, useOnUmbrel } from '@/features/connection/hermes-connection-form'
import { ask } from './ask'

// "Connect a model", wired to Hermes. Used full screen in onboarding and
// inside a sheet in Settings.

const confirmExpensive: Confirm = (message) => ask({ title: 'Use this model?', body: message, action: 'Use it' })

const errorText = (e: unknown) => (e instanceof Error && e.message) || 'Something went wrong. Try again.'

/** A beat on "Ready" (the buddy waking up) before moving on. */
const READY_BEAT_MS = 1400

/** Where Hermes runs, for "Run a model on …". */
function placeOf(c: HermesConnection | undefined, umbrel: boolean) {
  if (umbrel) return 'this Umbrel'
  if (!c) return 'this computer'
  let host = ''
  try {
    host = new URL(c.url).hostname
  } catch {
    // Unreadable: said as "this computer" below only when built in.
  }
  if (isBuiltinHermes(c) || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(host)) return 'this computer'
  return c.name || host || 'its computer'
}

type Props = {
  onConnected: () => void
  onSkip?: () => void
  embedded?: boolean
  options?: ConnectOption[]
}

export function ConnectFlow({ onConnected, onSkip, embedded, options }: Props) {
  const refresh = useRefreshModels()
  const umbrel = useOnUmbrel()
  const connection = useHermesConnection().connection
  const chatgpt = useChatGPTSignIn(async () => {
    await adoptChatGPT(confirmExpensive)
    await refresh()
  })
  const discovered = useLocalServers()
  const [added, setAdded] = useState<LocalServer[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const deviceModels = useDeviceModels()
  const found = useFindModel()
  const device = useDeviceSetup(async () => {
    await Promise.all([refresh(), new Promise((done) => setTimeout(done, READY_BEAT_MS))])
    onConnected()
  }, found.model)

  const state: ConnectState = {
    options,
    chatgpt: chatgpt.flow,
    local: {
      loading: discovered.isPending,
      servers: [...(discovered.data ?? []), ...added.filter((a) => !discovered.data?.some((d) => d.baseUrl === a.baseUrl))],
      connecting,
      adding,
      addError,
    },
    apiKey: { validating, error: keyError },
    device: {
      supported: Boolean(deviceModels.data?.supported),
      loading: deviceModels.isPending,
      place: placeOf(connection, umbrel),
      models: deviceModels.data?.models ?? [],
      tight: deviceModels.data?.tight,
      setup: device.setup,
      custom: {
        query: found.query,
        finding: found.finding,
        error: found.error,
        // While one typed in by name sets up (found again after a reload, say), that one.
        model: device.setup && device.custom?.id === device.setup.id ? device.custom : found.model,
      },
    },
  }

  return (
    <ConnectModel
      state={state}
      embedded={embedded}
      umbrel={umbrel}
      onSkip={onSkip}
      onDone={onConnected}
      onChooseChatGPT={() => void chatgpt.start()}
      onRunDevice={device.start}
      onPauseDevice={() => void device.pause()}
      onResumeDevice={device.resume}
      onCancelDevice={() => void device.cancel()}
      onFindDevice={(query) => void found.find(query)}
      onChooseLocal={async (server, model) => {
        setConnecting(model.id)
        try {
          await connectLocal(server, model)
          await refresh()
          onConnected()
        } catch (e) {
          setAddError(errorText(e))
        } finally {
          setConnecting(null)
        }
      }}
      onAddServer={async (url) => {
        setAdding(true)
        setAddError(null)
        try {
          const server = await findServer(url)
          setAdded((list) => [...list.filter((s) => s.baseUrl !== server.baseUrl), server])
        } catch (e) {
          setAddError(errorText(e))
        } finally {
          setAdding(false)
        }
      }}
      onSubmitKey={async (service, key) => {
        setValidating(true)
        setKeyError(null)
        try {
          await connectApiKey(service, key, confirmExpensive)
          await refresh()
          onConnected()
        } catch (e) {
          setKeyError(errorText(e))
        } finally {
          setValidating(false)
        }
      }}
    />
  )
}
