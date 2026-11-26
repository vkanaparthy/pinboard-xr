import { RoundedBox } from '@react-three/drei'
import { PROVIDERS } from '../services/localAiClient'
import { useSpatialStore, type Vec3 } from '../store/useSpatialStore'
import { useCardTexture } from '../utils/canvasTexture'
import { Button3D } from './Button3D'

const PANEL_W = 0.78
const PANEL_H = 0.27
const STATUS_H = 0.062
const BUTTON_H = 0.06
const GAP = 0.012
const COLS = 3
const BUTTON_W = (PANEL_W - GAP * (COLS + 1)) / COLS
/** Tilt the dock back so it faces the eyes of a standing user. */
const TILT_X = -0.38

function useStatusLine(): { text: string; tone: 'idle' | 'busy' | 'error' | 'listening' | 'info' } {
  const ai = useSpatialStore((s) => s.ai)
  const voice = useSpatialStore((s) => s.voice)
  const provider = useSpatialStore((s) => s.provider)
  const model = useSpatialStore((s) => s.models[s.provider])
  const noteCount = useSpatialStore((s) => s.notes.length)

  if (voice.listening) {
    return { text: voice.transcript ? `Listening… “${voice.transcript}”` : 'Listening… speak now, press again to stop', tone: 'listening' }
  }
  if (ai.busy && ai.task) return { text: ai.task, tone: 'busy' }
  if (ai.error) return { text: `Error: ${ai.error}`, tone: 'error' }
  if (ai.message) return { text: ai.message, tone: 'info' }
  return {
    text: `Ready  ·  ${PROVIDERS[provider].label}  ·  ${model || 'no model set'}  ·  ${noteCount} note${noteCount === 1 ? '' : 's'}`,
    tone: 'idle',
  }
}

const TONE_COLORS = {
  idle: { bg: '#1f2430', fg: '#c9d1e0' },
  busy: { bg: '#2b2a52', fg: '#d8d4ff' },
  error: { bg: '#4a1d22', fg: '#ffd1d4' },
  listening: { bg: '#4a1d3a', fg: '#ffd3ec' },
  info: { bg: '#173b2c', fg: '#c8f5dd' },
} as const

export function ControlDock() {
  const dockPosition = useSpatialStore((s) => s.dockPosition)
  const addNote = useSpatialStore((s) => s.addNote)
  const voiceNote = useSpatialStore((s) => s.voiceNote)
  const summarizeBoard = useSpatialStore((s) => s.summarizeBoard)
  const toggleTimer = useSpatialStore((s) => s.toggleTimer)
  const resetTimer = useSpatialStore((s) => s.resetTimer)
  const toggleProvider = useSpatialStore((s) => s.toggleProvider)
  const clearAiMessage = useSpatialStore((s) => s.clearAiMessage)
  const running = useSpatialStore((s) => s.timer.running)
  const listening = useSpatialStore((s) => s.voice.listening)
  const busy = useSpatialStore((s) => s.ai.busy)
  const provider = useSpatialStore((s) => s.provider)

  const status = useStatusLine()
  const tone = TONE_COLORS[status.tone]
  const statusW = PANEL_W - GAP * 2

  const statusTexture = useCardTexture(statusW, STATUS_H, (s) => ({
    background: tone.bg,
    radius: s(12),
    padding: s(10),
    header: { text: 'SPATIAL FOCUS  ·  LOCAL AI', color: '#7f8aa3', size: s(9), weight: 700, letterSpacing: s(0.8) },
    body: { text: status.text, color: tone.fg, size: s(14), minSize: s(9), weight: 500, lineHeight: 1.15 },
  }))

  const colX = (col: number): number => -PANEL_W / 2 + GAP + BUTTON_W / 2 + col * (BUTTON_W + GAP)
  const statusY = PANEL_H / 2 - GAP - STATUS_H / 2
  const row1Y = statusY - STATUS_H / 2 - GAP - BUTTON_H / 2
  const row2Y = row1Y - BUTTON_H - GAP
  const z = 0.008

  const buttons: Array<{
    label: string
    col: number
    y: number
    color: string
    hover: string
    text: string
    onClick: () => void
    disabled?: boolean
  }> = [
    { label: '+ New Note', col: 0, y: row1Y, color: '#ffe066', hover: '#fff09a', text: '#3b2f00', onClick: () => addNote() },
    {
      label: listening ? 'Stop Listening' : 'Voice / AI Note',
      col: 1,
      y: row1Y,
      color: listening ? '#ff5c8a' : '#ffa8cf',
      hover: listening ? '#ff7ea2' : '#ffc6df',
      text: '#4a0f2b',
      onClick: () => void voiceNote(),
      disabled: busy && !listening,
    },
    {
      label: 'AI Summarize Board',
      col: 2,
      y: row1Y,
      color: '#7fe3f0',
      hover: '#a9eef7',
      text: '#05343b',
      onClick: () => void summarizeBoard(),
      disabled: busy,
    },
    {
      label: running ? 'Pause Timer' : 'Start Timer',
      col: 0,
      y: row2Y,
      color: running ? '#f5b942' : '#46d48c',
      hover: running ? '#ffd27a' : '#7be6ad',
      text: '#0d1016',
      onClick: toggleTimer,
    },
    { label: 'Reset Timer', col: 1, y: row2Y, color: '#2f3542', hover: '#404859', text: '#ffffff', onClick: resetTimer },
    {
      label: `AI: ${PROVIDERS[provider].label} · switch`,
      col: 2,
      y: row2Y,
      color: provider === 'ollama' ? '#b9a5ff' : '#8fd3ff',
      hover: provider === 'ollama' ? '#d2c6ff' : '#b8e4ff',
      text: '#14122b',
      onClick: toggleProvider,
      disabled: busy,
    },
  ]

  return (
    <group position={dockPosition as Vec3} rotation={[TILT_X, 0, 0]}>
      <RoundedBox args={[PANEL_W, PANEL_H, 0.012]} radius={0.016} smoothness={3}>
        <meshBasicMaterial color="#10131a" transparent opacity={0.92} toneMapped={false} />
      </RoundedBox>

      <mesh
        position={[0, statusY, z]}
        onClick={(e) => {
          e.stopPropagation()
          if (!busy) clearAiMessage()
        }}
      >
        <planeGeometry args={[statusW, STATUS_H]} />
        <meshBasicMaterial map={statusTexture} alphaTest={0.5} toneMapped={false} />
      </mesh>

      {buttons.map((b) => (
        <Button3D
          key={`${b.col}-${b.y}`}
          label={b.label}
          position={[colX(b.col), b.y, z]}
          width={BUTTON_W}
          height={BUTTON_H}
          color={b.color}
          hoverColor={b.hover}
          textColor={b.text}
          fontSize={15}
          disabled={b.disabled}
          onClick={b.onClick}
        />
      ))}
    </group>
  )
}
