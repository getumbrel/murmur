import { useState } from 'react'
import { ConnectModel, type ConnectOption, type ConnectState } from '@/features/onboarding/connect'
import { choiceKey } from '@/features/onboarding/server-panel'
import {
  adoptChatGPT,
  connectApiKey,
  connectServer,
  findServer,
  useChatGPTSignIn,
  useLocalServers,
  useRefreshModels,
  type Confirm,
} from '@/state/models'
import { useDeviceModels, useDeviceSetup, useFindModel } from '@/state/local-runtime'
import { useConnectionOn, type HermesConnection } from '@/state/connection'
import { isBuiltinHermes, useHermesOnThisUmbrel } from '@/features/connection/hermes-connection-form'
import { useScopeHermes } from '@/features/connection/scope'
import { ask } from './ask'

// "Connect a model", wired to Hermes. Used full screen in onboarding and
// inside a sheet in Settings, where it connects the Hermes Settings is
// showing (features/connection/scope.tsx).

const confirmExpensive: Confirm = (message) => ask({ title: 'Use this model?', body: message, action: 'Use it' })

const errorText = (e: unknown) => (e instanceof Error && e.message) || 'Something went wrong. Try again.'

/** A beat on "Ready" (the buddy waking up) before moving on. */
const READY_BEAT_MS = 1400

/** Where Hermes runs, for "Run a model on …". */
function placeOf(c: Partial<HermesConnection> | undefined, umbrel: boolean) {
  if (umbrel) return 'this Umbrel'
  if (!c?.url) return 'this computer'
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
  const hermes = useScopeHermes()
  const connection = useConnectionOn(hermes)
  // (Of this Hermes, not of Murmur: a Hermes elsewhere isn't "this Umbrel", wherever Murmur runs.)
  const umbrel = useHermesOnThisUmbrel(connection)
  const chatgpt = useChatGPTSignIn(hermes, async () => {
    await adoptChatGPT(hermes, confirmExpensive)
    await refresh()
  })
  const discovered = useLocalServers(hermes)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const deviceModels = useDeviceModels(hermes)
  const found = useFindModel(hermes)
  const device = useDeviceSetup(hermes, async () => {
    await Promise.all([refresh(), new Promise((done) => setTimeout(done, READY_BEAT_MS))])
    onConnected()
  }, found.model)

  const state: ConnectState = {
    options,
    chatgpt: chatgpt.flow,
    local: {
      loading: discovered.isPending,
      servers: discovered.data ?? [],
      connecting,
      error: serverError,
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
        setConnecting(choiceKey(server, model))
        setServerError(null)
        try {
          await connectServer(hermes, server, model)
          await refresh()
          onConnected()
        } catch (e) {
          setServerError(errorText(e))
        } finally {
          setConnecting(null)
        }
      }}
      onFindServer={(address, apiKey) => findServer(hermes, address, apiKey)}
      onSubmitKey={async (service, key) => {
        setValidating(true)
        setKeyError(null)
        try {
          await connectApiKey(hermes, service, key, confirmExpensive)
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
