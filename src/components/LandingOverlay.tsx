import { useEffect, useState } from 'react'
import {
  PROVIDERS,
  PROVIDER_ORDER,
  describeAiError,
  listModels,
  testConnection,
  type ConnectionReport,
  type Provider,
} from '../services/localAiClient'
import { isSpeechRecognitionSupported } from '../services/speech'
import { THOUGHT_PRESETS, useSpatialStore } from '../store/useSpatialStore'
import { isLocalhost } from '../utils/desktopEmulator'

type XrSupport = 'checking' | 'supported' | 'unsupported' | 'insecure'

export interface LandingOverlayProps {
  /** `useEmulator` is true when no real headset is available and the page runs on localhost. */
  onEnterAR: (useEmulator: boolean) => Promise<void>
}

function useArSupport(): XrSupport {
  const [support, setSupport] = useState<XrSupport>('checking')
  useEffect(() => {
    let cancelled = false
    if (!window.isSecureContext) {
      setSupport('insecure')
      return
    }
    const xr = navigator.xr
    if (!xr) {
      setSupport('unsupported')
      return
    }
    xr.isSessionSupported('immersive-ar')
      .then((ok) => !cancelled && setSupport(ok ? 'supported' : 'unsupported'))
      .catch(() => !cancelled && setSupport('unsupported'))
    return () => {
      cancelled = true
    }
  }, [])
  return support
}

const SUPPORT_TEXT: Record<XrSupport, string> = {
  checking: 'Checking WebXR support…',
  supported: 'Mixed reality (immersive-ar) is supported on this device.',
  unsupported: 'No headset found. Open https://localhost:5173 on this Mac to use the built-in Quest 3 emulator.',
  insecure: 'This page is not on HTTPS, so WebXR is disabled. Open the https:// address.',
}

export function LandingOverlay({ onEnterAR }: LandingOverlayProps) {
  const support = useArSupport()
  const [collapsed, setCollapsed] = useState(false)
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState<string | null>(null)

  const provider = useSpatialStore((s) => s.provider)
  const models = useSpatialStore((s) => s.models)
  const setProvider = useSpatialStore((s) => s.setProvider)
  const setModel = useSpatialStore((s) => s.setModel)
  const fallbackThought = useSpatialStore((s) => s.fallbackThought)
  const setFallbackThought = useSpatialStore((s) => s.setFallbackThought)
  const submitThought = useSpatialStore((s) => s.submitThought)
  const noteCount = useSpatialStore((s) => s.notes.length)
  const clearBoard = useSpatialStore((s) => s.clearBoard)
  const ai = useSpatialStore((s) => s.ai)

  const [available, setAvailable] = useState<Record<Provider, string[]>>({ ollama: [], muse: [] })
  const [report, setReport] = useState<ConnectionReport | null>(null)
  const [testing, setTesting] = useState(false)

  // Fetch the model list for the active provider so the picker can offer installed models.
  useEffect(() => {
    const controller = new AbortController()
    listModels(provider, controller.signal)
      .then((list) => setAvailable((prev) => ({ ...prev, [provider]: list })))
      .catch(() => setAvailable((prev) => ({ ...prev, [provider]: [] })))
    setReport(null)
    return () => controller.abort()
  }, [provider])

  const runTest = async () => {
    setTesting(true)
    const result = await testConnection(provider, models[provider])
    setReport(result)
    setAvailable((prev) => ({ ...prev, [provider]: result.models }))
    setTesting(false)
  }

  const useEmulator = support === 'unsupported' && isLocalhost()

  const enter = async () => {
    setEntering(true)
    setEnterError(null)
    try {
      await onEnterAR(useEmulator)
    } catch (error) {
      setEnterError(describeAiError(error))
    } finally {
      setEntering(false)
    }
  }

  if (collapsed) {
    return (
      <div className="overlay-pill">
        <span>Desktop preview — drag to orbit, drag notes to move, double-click a note to edit</span>
        <button type="button" onClick={() => setCollapsed(false)}>
          Show panel
        </button>
      </div>
    )
  }

  const modelList = available[provider]
  const route = `${PROVIDERS[provider].basePath} → ${__AI_PROXY_TARGETS__[provider]}`

  return (
    <div className="overlay">
      <div className="panel">
        <header>
          <div className="logo" aria-hidden />
          <div>
            <h1>Spatial Focus &amp; AI Sticky Notes</h1>
            <p className="muted">A mixed-reality pinboard for Meta Quest 3S, powered by models running on your Mac.</p>
          </div>
        </header>

        <section className="actions">
          <button type="button" className="primary" disabled={entering || support === 'insecure' || support === 'checking'} onClick={() => void enter()}>
            {entering ? (useEmulator ? 'Loading emulator…' : 'Starting…') : useEmulator ? 'Enter Mixed Reality (emulator)' : 'Enter Mixed Reality'}
          </button>
          <button type="button" className="ghost" onClick={() => setCollapsed(true)}>
            Desktop preview
          </button>
        </section>
        <p className={`badge ${useEmulator ? 'supported' : support}`}>
          {useEmulator
            ? 'No headset found, so a virtual Quest 3 is used: drag in the scene to look around, use the emulator panel to move controllers, and pull a trigger to press buttons or grab notes.'
            : SUPPORT_TEXT[support]}
        </p>
        {enterError && <p className="error">Could not start mixed reality: {enterError}</p>}

        <section className="card">
          <h2>Local AI</h2>
          <div className="segmented" role="radiogroup" aria-label="AI provider">
            {PROVIDER_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={provider === id}
                className={provider === id ? 'active' : ''}
                onClick={() => setProvider(id)}
              >
                {PROVIDERS[id].label}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Model for {PROVIDERS[provider].label}</span>
            <div className="row">
              <input
                list={`models-${provider}`}
                value={models[provider]}
                placeholder={provider === 'ollama' ? 'e.g. llama3.2' : 'model id served by MUSE'}
                onChange={(e) => setModel(provider, e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
              />
              {modelList.length > 0 && (
                <select aria-label="Installed models" value="" onChange={(e) => e.target.value && setModel(provider, e.target.value)}>
                  <option value="">Pick…</option>
                  {modelList.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <datalist id={`models-${provider}`}>
              {modelList.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          <div className="row">
            <button type="button" onClick={() => void runTest()} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <code className="route">{route}</code>
          </div>
          {report && <p className={report.ok ? 'ok' : 'error'}>{report.message}</p>}
        </section>

        <section className="card">
          <h2>Voice fallback</h2>
          <p className="muted small">
            Speech recognition is {isSpeechRecognitionSupported() ? 'available' : 'not available'} in this browser. When it isn’t
            available in the headset, “Voice / AI Note” uses this thought (and then rotates through the presets).
          </p>
          <select aria-label="Preset thoughts" value="" onChange={(e) => e.target.value && setFallbackThought(e.target.value)}>
            <option value="">Load a preset…</option>
            {THOUGHT_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p.slice(0, 60)}…
              </option>
            ))}
          </select>
          <textarea rows={3} value={fallbackThought} onChange={(e) => setFallbackThought(e.target.value)} />
          <div className="row">
            <button type="button" disabled={ai.busy || !fallbackThought.trim()} onClick={() => void submitThought(fallbackThought)}>
              {ai.busy ? 'Thinking…' : 'Send to AI now'}
            </button>
            <span className="muted small">{ai.error ? `Error: ${ai.error}` : ai.message ?? ''}</span>
          </div>
        </section>

        <footer className="row between">
          <span className="muted small">
            {noteCount} note{noteCount === 1 ? '' : 's'} on the board (saved in this browser)
          </span>
          <button
            type="button"
            className="ghost danger"
            disabled={noteCount === 0}
            onClick={() => {
              if (window.confirm('Remove all sticky notes from the board?')) clearBoard()
            }}
          >
            Clear board
          </button>
        </footer>
      </div>
    </div>
  )
}
