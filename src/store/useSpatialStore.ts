import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { Quaternion, Vector3 } from 'three'
import {
  PROVIDERS,
  describeAiError,
  expandNote as aiExpandNote,
  isProvider,
  summarizeBoard as aiSummarizeBoard,
  thoughtToNotes,
  type Provider,
} from '../services/localAiClient'
import { SpeechCaptureError, isSpeechRecognitionSupported, listenOnce, type ListenHandle } from '../services/speech'

/* ------------------------------------------------------------------ */
/* Types & constants                                                  */
/* ------------------------------------------------------------------ */

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export interface Transform {
  position: Vec3
  quaternion: Quat
}

export type NoteColor = 'yellow' | 'cyan' | 'pink'
export const NOTE_COLORS: NoteColor[] = ['yellow', 'cyan', 'pink']

export interface NotePalette {
  paper: string
  edge: string
  ink: string
  muted: string
  button: string
  buttonHover: string
}

export const NOTE_PALETTE: Record<NoteColor, NotePalette> = {
  yellow: { paper: '#ffe066', edge: '#e0b400', ink: '#3b2f00', muted: '#7a6300', button: '#fff3b0', buttonHover: '#fff9d9' },
  cyan: { paper: '#7fe3f0', edge: '#2bb7c9', ink: '#05343b', muted: '#1c6670', button: '#c7f4fa', buttonHover: '#e6fbfd' },
  pink: { paper: '#ffa8cf', edge: '#e5609e', ink: '#4a0f2b', muted: '#8a2f59', button: '#ffd6e8', buttonHover: '#ffeaf3' },
}

export type NoteKind = 'manual' | 'ai' | 'summary' | 'step'

/** Width / height of the paper area in meters. */
export const NOTE_SIZES: Record<NoteKind, [number, number]> = {
  manual: [0.24, 0.2],
  ai: [0.24, 0.2],
  summary: [0.34, 0.3],
  step: [0.22, 0.11],
}

const KIND_LABEL: Record<NoteKind, string> = {
  manual: 'NOTE',
  ai: 'AI NOTE',
  summary: 'AI ACTION PLAN',
  step: 'SUB-STEP',
}

export function noteKindLabel(kind: NoteKind): string {
  return KIND_LABEL[kind]
}

export interface Note {
  id: string
  text: string
  color: NoteColor
  kind: NoteKind
  position: Vec3
  quaternion: Quat
  createdAt: number
  parentId?: string
}

export const POMODORO_MS = 25 * 60 * 1000

export interface TimerState {
  durationMs: number
  remainingMs: number
  running: boolean
  /** Epoch ms at which the running timer hits zero. */
  endsAt: number | null
  completedAt: number | null
}

export interface AiState {
  busy: boolean
  task: string | null
  busyNoteId: string | null
  error: string | null
  message: string | null
}

export interface VoiceState {
  listening: boolean
  transcript: string
}

export const THOUGHT_PRESETS: string[] = [
  'I need to finish the quarterly report, reply to Sam about the launch date, and book a dentist appointment before Friday.',
  'Plan the weekend trip: check the weather, pack hiking gear, and reserve a campsite.',
  'Refactor the login flow, write tests for the payment module, and update the README.',
]

const NOTE_TEMPLATES: string[] = [
  'New idea — double-click on desktop to edit',
  'Next action: …',
  'Remember to…',
]

const DOCK_POSITION: Vec3 = [0, 1.25, -0.75]
const DEFAULT_TIMER_CARD: Transform = {
  position: [0.62, 1.42, -0.78],
  quaternion: yawQuaternion(-0.45),
}

/* ------------------------------------------------------------------ */
/* Scene refs written by the 3D scene, read by actions (non-reactive) */
/* ------------------------------------------------------------------ */

export const sceneRefs: {
  viewerPosition: Vector3
  viewerQuaternion: Quaternion
  orbitControls: { enabled: boolean } | null
} = {
  viewerPosition: new Vector3(0, 1.55, 0.55),
  viewerQuaternion: new Quaternion(),
  orbitControls: null,
}

/** Desktop only: stop OrbitControls from rotating the camera while a note is dragged. */
export function setOrbitEnabled(enabled: boolean): void {
  if (sceneRefs.orbitControls) sceneRefs.orbitControls.enabled = enabled
}

function yawQuaternion(yaw: number): Quat {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
  return [q.x, q.y, q.z, q.w]
}

/** Flattened forward direction and yaw of the user's head. */
function viewerFrame(): { origin: Vector3; forward: Vector3; right: Vector3; quaternion: Quat } {
  const origin = sceneRefs.viewerPosition.clone()
  const forward = new Vector3(0, 0, -1).applyQuaternion(sceneRefs.viewerQuaternion)
  forward.y = 0
  if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1)
  forward.normalize()
  const right = new Vector3(-forward.z, 0, forward.x)
  // Rotate the note so its front (+Z) faces the user.
  const yaw = Math.atan2(-forward.x, -forward.z)
  return { origin, forward, right, quaternion: yawQuaternion(yaw) }
}

let spawnCounter = 0

/** Room each note needs around it, including its button row (meters). */
function footprint(size: [number, number]): [number, number] {
  return [size[0] + 0.03, size[1] + 0.085]
}

/**
 * Finds `count` free spots ~65 cm in front of the user, at and above eye level (so the dock
 * below stays visible), skipping places already taken by other notes. Slots are tried
 * center-out; if the wall is full, notes stack slightly closer to the user.
 */
function spawnFree(count: number, size: [number, number], existing: Note[], distance = 0.65): Transform[] {
  const { origin, forward, right, quaternion } = viewerFrame()
  const [fw, fh] = footprint(size)

  const occupied = existing.map((n) => {
    const rel = new Vector3(...n.position).sub(origin)
    const [w, h] = footprint(NOTE_SIZES[n.kind])
    return { x: rel.dot(right), y: rel.y, d: rel.dot(forward), w, h }
  })

  const isFree = (x: number, y: number, d: number) =>
    occupied.every(
      (o) => Math.abs(o.x - x) >= (o.w + fw) / 2 || Math.abs(o.y - y) >= (o.h + fh) / 2 || Math.abs(o.d - d) > 0.2,
    )

  const candidates: Array<{ x: number; y: number }> = []
  for (let row = 0; row < 3; row++) {
    const y = 0.03 + row * fh
    for (let col = 0; col <= 3; col++) {
      for (const sign of col === 0 ? [1] : [-1, 1]) candidates.push({ x: sign * col * fw, y })
    }
  }
  // Closest to the center of view first (rows above count a bit more than columns aside).
  candidates.sort((a, b) => Math.hypot(a.x, (a.y - 0.03) * 1.3) - Math.hypot(b.x, (b.y - 0.03) * 1.3))

  const out: Transform[] = []
  for (let i = 0; i < count; i++) {
    let pick = candidates.find((c) => isFree(c.x, c.y, distance))
    let d = distance
    if (!pick) {
      // Wall is full: stack slightly in front of the existing layer.
      d = distance - 0.06 * (1 + (spawnCounter++ % 4))
      pick = { x: ((i % 3) - 1) * fw, y: 0.03 }
    }
    occupied.push({ x: pick.x, y: pick.y, d, w: fw, h: fh })
    const p = origin.clone().addScaledVector(forward, d).addScaledVector(right, pick.x).add(new Vector3(0, pick.y, 0))
    out.push({ position: [p.x, p.y, p.z], quaternion })
  }
  return out
}

/**
 * Sub-step notes stacked in a column beside the parent note: on the right, or on the left
 * when that side is less crowded (other notes, the timer card).
 */
function stepsBeside(parent: Note, count: number, existing: Note[], timerCard: Transform): Transform[] {
  const [pw] = NOTE_SIZES[parent.kind]
  const [sw, sh] = NOTE_SIZES.step
  const q = new Quaternion(...parent.quaternion)
  const right = new Vector3(1, 0, 0).applyQuaternion(q)
  const up = new Vector3(0, 1, 0).applyQuaternion(q)
  const pitch = sh + 0.075

  const obstacles = [
    ...existing.filter((n) => n.id !== parent.id).map((n) => ({ p: new Vector3(...n.position), size: NOTE_SIZES[n.kind] })),
    { p: new Vector3(...timerCard.position), size: [0.28, 0.22] as [number, number] },
  ]

  const column = (side: 1 | -1): Vector3[] => {
    const base = new Vector3(...parent.position).addScaledVector(right, side * (pw / 2 + 0.04 + sw / 2))
    return Array.from({ length: count }, (_, i) => base.clone().addScaledVector(up, ((count - 1) / 2 - i) * pitch))
  }

  const collisions = (points: Vector3[]): number =>
    points.reduce((total, p) => {
      const hits = obstacles.filter(({ p: o, size }) => {
        const [ow, oh] = footprint(size)
        const [fw, fh] = footprint([sw, sh])
        return Math.abs(o.x - p.x) < (ow + fw) / 2 && Math.abs(o.y - p.y) < (oh + fh) / 2 && Math.abs(o.z - p.z) < 0.25
      }).length
      return total + hits
    }, 0)

  const rightCol = column(1)
  const leftCol = column(-1)
  const leftHits = collisions(leftCol)
  const rightHits = collisions(rightCol)
  const chosen = leftHits < rightHits ? leftCol : rightCol
  if (Math.min(leftHits, rightHits) > 0) {
    // Both sides are crowded: float the steps 8 cm in front of the board so they stay readable.
    const towardUser = new Vector3(0, 0, 1).applyQuaternion(q)
    chosen.forEach((p) => p.addScaledVector(towardUser, 0.08))
  }
  return chosen.map((p) => ({ position: [p.x, p.y, p.z], quaternion: [...parent.quaternion] as Quat }))
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/* ------------------------------------------------------------------ */
/* Sound (Pomodoro chime)                                             */
/* ------------------------------------------------------------------ */

let audioContext: AudioContext | null = null

/** Call from a user gesture (e.g. pressing Start) so the browser lets us play audio later. */
function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioContext ??= new Ctor()
    if (audioContext.state === 'suspended') void audioContext.resume()
  } catch {
    audioContext = null
  }
}

function playChime(): void {
  if (!audioContext) return
  const ctx = audioContext
  const now = ctx.currentTime
  ;[0, 0.28, 0.56].forEach((offset, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = [880, 988, 1319][i]
    gain.gain.setValueAtTime(0.0001, now + offset)
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + offset)
    osc.stop(now + offset + 0.55)
  })
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export interface SpatialState {
  notes: Note[]
  timer: TimerState
  timerCard: Transform
  dockPosition: Vec3
  provider: Provider
  models: Record<Provider, string>
  ai: AiState
  voice: VoiceState
  fallbackThought: string
  inXR: boolean

  // notes
  addNote: (text?: string, color?: NoteColor) => void
  updateNoteText: (id: string, text: string) => void
  cycleNoteColor: (id: string) => void
  removeNote: (id: string) => void
  setNoteTransform: (id: string, transform: Transform) => void
  clearBoard: () => void

  // timer
  toggleTimer: () => void
  resetTimer: () => void
  tickTimer: (now: number) => void
  setTimerCardTransform: (transform: Transform) => void

  // provider
  setProvider: (provider: Provider) => void
  toggleProvider: () => void
  setModel: (provider: Provider, model: string) => void

  // AI + voice
  voiceNote: () => Promise<void>
  submitThought: (thought: string, note?: string) => Promise<void>
  summarizeBoard: () => Promise<void>
  expandNote: (id: string) => Promise<void>
  setFallbackThought: (text: string) => void
  clearAiMessage: () => void

  setInXR: (inXR: boolean) => void
}

function envProvider(): Provider {
  const value = (import.meta.env.VITE_AI_PROVIDER ?? 'ollama').toLowerCase()
  return isProvider(value) ? value : 'ollama'
}

const initialTimer: TimerState = {
  durationMs: POMODORO_MS,
  remainingMs: POMODORO_MS,
  running: false,
  endsAt: null,
  completedAt: null,
}

const idleAi: AiState = { busy: false, task: null, busyNoteId: null, error: null, message: null }

let activeListen: ListenHandle | null = null

export const useSpatialStore = create<SpatialState>()(
  persist(
    (set, get) => {
      /** Runs one AI job at a time and keeps the loading / error state in sync. */
      async function runAiTask<T>(task: string, busyNoteId: string | null, job: () => Promise<T>): Promise<T | null> {
        if (get().ai.busy) {
          set({ ai: { ...get().ai, message: 'Still working on the previous request…' } })
          return null
        }
        set({ ai: { busy: true, task, busyNoteId, error: null, message: null } })
        try {
          const result = await job()
          set({ ai: { ...idleAi } })
          return result
        } catch (error) {
          set({ ai: { ...idleAi, error: describeAiError(error) } })
          return null
        }
      }

      function activeModel(): { provider: Provider; model: string } {
        const { provider, models } = get()
        return { provider, model: models[provider] }
      }

      return {
        notes: [],
        timer: initialTimer,
        timerCard: DEFAULT_TIMER_CARD,
        dockPosition: DOCK_POSITION,
        provider: envProvider(),
        models: {
          ollama: import.meta.env.VITE_OLLAMA_MODEL || 'llama3.2',
          muse: import.meta.env.VITE_MUSE_MODEL || 'muse',
        },
        ai: idleAi,
        voice: { listening: false, transcript: '' },
        fallbackThought: THOUGHT_PRESETS[0],
        inXR: false,

        /* ---------------- notes ---------------- */

        addNote: (text, color) => {
          const template = NOTE_TEMPLATES[get().notes.length % NOTE_TEMPLATES.length]
          const [transform] = spawnFree(1, NOTE_SIZES.manual, get().notes)
          const note: Note = {
            id: makeId(),
            text: text ?? template,
            color: color ?? NOTE_COLORS[get().notes.length % NOTE_COLORS.length],
            kind: 'manual',
            createdAt: Date.now(),
            ...transform,
          }
          set({ notes: [...get().notes, note] })
        },

        updateNoteText: (id, text) => {
          set({ notes: get().notes.map((n) => (n.id === id ? { ...n, text: text.trim() || n.text } : n)) })
        },

        cycleNoteColor: (id) => {
          set({
            notes: get().notes.map((n) => {
              if (n.id !== id) return n
              const next = NOTE_COLORS[(NOTE_COLORS.indexOf(n.color) + 1) % NOTE_COLORS.length]
              return { ...n, color: next }
            }),
          })
        },

        removeNote: (id) => {
          set({ notes: get().notes.filter((n) => n.id !== id) })
        },

        setNoteTransform: (id, transform) => {
          set({ notes: get().notes.map((n) => (n.id === id ? { ...n, ...transform } : n)) })
        },

        clearBoard: () => set({ notes: [] }),

        /* ---------------- timer ---------------- */

        toggleTimer: () => {
          unlockAudio()
          const { timer } = get()
          const now = Date.now()
          if (timer.running) {
            const remainingMs = Math.max(0, (timer.endsAt ?? now) - now)
            set({ timer: { ...timer, running: false, endsAt: null, remainingMs } })
          } else {
            const remainingMs = timer.remainingMs > 0 ? timer.remainingMs : timer.durationMs
            set({ timer: { ...timer, running: true, endsAt: now + remainingMs, remainingMs, completedAt: null } })
          }
        },

        resetTimer: () => {
          set({ timer: { ...initialTimer, durationMs: get().timer.durationMs, remainingMs: get().timer.durationMs } })
        },

        tickTimer: (now) => {
          const { timer } = get()
          if (!timer.running || timer.endsAt === null) return
          const remainingMs = Math.max(0, timer.endsAt - now)
          if (remainingMs === 0) {
            set({ timer: { ...timer, running: false, endsAt: null, remainingMs: 0, completedAt: now } })
            playChime()
            return
          }
          // Only write when the displayed second changes, to avoid re-rendering every frame.
          if (Math.ceil(remainingMs / 1000) !== Math.ceil(timer.remainingMs / 1000)) {
            set({ timer: { ...timer, remainingMs } })
          }
        },

        setTimerCardTransform: (transform) => set({ timerCard: transform }),

        /* ---------------- provider ---------------- */

        setProvider: (provider) => set({ provider, ai: { ...get().ai, error: null } }),

        toggleProvider: () => {
          const next: Provider = get().provider === 'ollama' ? 'muse' : 'ollama'
          set({
            provider: next,
            ai: { ...get().ai, error: null, message: `Switched to ${PROVIDERS[next].label} · ${get().models[next]}` },
          })
        },

        setModel: (provider, model) => set({ models: { ...get().models, [provider]: model } }),

        /* ---------------- AI + voice ---------------- */

        voiceNote: async () => {
          if (activeListen) {
            activeListen.stop()
            return
          }
          if (get().ai.busy) {
            set({ ai: { ...get().ai, message: 'Still working on the previous request…' } })
            return
          }

          const fallback = async (reason: string) => {
            let thought = get().fallbackThought
            if (!get().inXR && typeof window.prompt === 'function') {
              const typed = window.prompt(`${reason}\nType the thought to turn into sticky notes:`, thought)
              if (typed === null) {
                set({ ai: { ...get().ai, message: 'Voice note cancelled.' } })
                return
              }
              thought = typed
            } else {
              // Inside the headset there is no keyboard: rotate through the presets so each press differs.
              const idx = THOUGHT_PRESETS.indexOf(thought)
              if (idx !== -1) set({ fallbackThought: THOUGHT_PRESETS[(idx + 1) % THOUGHT_PRESETS.length] })
            }
            if (!thought.trim()) return
            await get().submitThought(thought, `${reason} Used fallback thought.`)
          }

          if (!isSpeechRecognitionSupported()) {
            await fallback('Speech recognition is not available here.')
            return
          }

          set({ voice: { listening: true, transcript: '' }, ai: { ...get().ai, error: null, message: null } })
          const handle = listenOnce({
            onInterim: (transcript) => set({ voice: { listening: true, transcript } }),
          })
          activeListen = handle
          try {
            const transcript = await handle.result
            set({ voice: { listening: false, transcript } })
            await get().submitThought(transcript)
          } catch (error) {
            set({ voice: { listening: false, transcript: '' } })
            const code = error instanceof SpeechCaptureError ? error.code : 'unknown'
            if (code === 'no-speech' || code === 'aborted') {
              set({ ai: { ...idleAi, error: describeAiError(error) } })
            } else {
              await fallback(describeAiError(error))
            }
          } finally {
            activeListen = null
          }
        },

        submitThought: async (thought, note) => {
          const { provider, model } = activeModel()
          const texts = await runAiTask(`Turning your thought into notes (${PROVIDERS[provider].label})…`, null, () =>
            thoughtToNotes(thought, { provider, model }),
          )
          if (!texts) return
          const transforms = spawnFree(texts.length, NOTE_SIZES.ai, get().notes)
          const color = NOTE_COLORS[get().notes.length % NOTE_COLORS.length]
          const created: Note[] = texts.map((text, i) => ({
            id: makeId(),
            text,
            color,
            kind: 'ai',
            createdAt: Date.now(),
            ...transforms[i],
          }))
          set({
            notes: [...get().notes, ...created],
            ai: { ...get().ai, message: `${note ? `${note} ` : ''}Added ${created.length} AI note${created.length === 1 ? '' : 's'}.` },
          })
        },

        summarizeBoard: async () => {
          const texts = get()
            .notes.filter((n) => n.kind !== 'summary')
            .map((n) => n.text)
          if (texts.length === 0) {
            set({ ai: { ...idleAi, error: 'Add some notes first, then summarize the board.' } })
            return
          }
          const { provider, model } = activeModel()
          const summary = await runAiTask(`Summarizing ${texts.length} notes…`, null, () =>
            aiSummarizeBoard(texts, { provider, model }),
          )
          if (!summary) return
          const [transform] = spawnFree(1, NOTE_SIZES.summary, get().notes)
          const note: Note = {
            id: makeId(),
            text: summary,
            color: 'cyan',
            kind: 'summary',
            createdAt: Date.now(),
            ...transform,
          }
          set({ notes: [...get().notes, note], ai: { ...get().ai, message: 'Action plan added.' } })
        },

        expandNote: async (id) => {
          const parent = get().notes.find((n) => n.id === id)
          if (!parent) return
          const { provider, model } = activeModel()
          const steps = await runAiTask('Breaking the note into sub-steps…', id, () =>
            aiExpandNote(parent.text, { provider, model }),
          )
          if (!steps) return
          // The parent may have moved or been deleted while the model was thinking.
          const latest = get().notes.find((n) => n.id === id) ?? parent
          const transforms = stepsBeside(latest, steps.length, get().notes, get().timerCard)
          const color = NOTE_COLORS[(NOTE_COLORS.indexOf(latest.color) + 1) % NOTE_COLORS.length]
          const created: Note[] = steps.map((text, i) => ({
            id: makeId(),
            text: `${i + 1}. ${text}`,
            color,
            kind: 'step',
            parentId: latest.id,
            createdAt: Date.now(),
            ...transforms[i],
          }))
          set({ notes: [...get().notes, ...created], ai: { ...get().ai, message: `Added ${created.length} sub-steps.` } })
        },

        setFallbackThought: (text) => set({ fallbackThought: text }),

        clearAiMessage: () => set({ ai: { ...get().ai, error: null, message: null } }),

        setInXR: (inXR) => set({ inXR }),
      }
    },
    {
      name: 'pinboard-xr-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        notes: state.notes,
        timerCard: state.timerCard,
        provider: state.provider,
        models: state.models,
        fallbackThought: state.fallbackThought,
      }),
    },
  ),
)
