/**
 * Minimal wrapper around the Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * Meta Quest Browser may not expose it, or may fail with "network"/"not-allowed" inside an
 * immersive session, so callers always get a clear error they can fall back from.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike }
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string
  readonly message?: string
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null
}

export class SpeechCaptureError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SpeechCaptureError'
    this.code = code
  }
}

export interface ListenOptions {
  lang?: string
  /** Stop automatically after this long, even if the user keeps talking. */
  maxDurationMs?: number
  onInterim?: (text: string) => void
}

export interface ListenHandle {
  /** Resolves with the final transcript, rejects with SpeechCaptureError. */
  result: Promise<string>
  /** Stop listening early and resolve with whatever was heard so far. */
  stop: () => void
}

const ERROR_MESSAGES: Record<string, string> = {
  'no-speech': 'No speech was detected.',
  'audio-capture': 'No microphone is available.',
  'not-allowed': 'Microphone permission was denied.',
  'service-not-allowed': 'Speech recognition is not allowed in this browser.',
  network: 'Speech recognition needs a network service that is unavailable.',
  aborted: 'Listening was cancelled.',
  'language-not-supported': 'This language is not supported for speech recognition.',
}

export function listenOnce({ lang = 'en-US', maxDurationMs = 15_000, onInterim }: ListenOptions = {}): ListenHandle {
  const Ctor = getRecognitionCtor()
  if (!Ctor) {
    return {
      result: Promise.reject(new SpeechCaptureError('unsupported', 'Speech recognition is not available in this browser.')),
      stop: () => undefined,
    }
  }

  const recognition = new Ctor()
  recognition.lang = lang
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  let finalText = ''
  let interimText = ''
  let settled = false
  let timer: number | undefined

  const result = new Promise<string>((resolve, reject) => {
    const finish = (error?: SpeechCaptureError) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      const text = `${finalText} ${interimText}`.replace(/\s+/g, ' ').trim()
      if (error && !text) reject(error)
      else if (!text) reject(new SpeechCaptureError('no-speech', ERROR_MESSAGES['no-speech']))
      else resolve(text)
    }

    recognition.onresult = (event) => {
      interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        const transcript = res[0]?.transcript ?? ''
        if (res.isFinal) finalText += ` ${transcript}`
        else interimText += ` ${transcript}`
      }
      onInterim?.(`${finalText} ${interimText}`.replace(/\s+/g, ' ').trim())
    }
    recognition.onerror = (event) => {
      finish(new SpeechCaptureError(event.error, ERROR_MESSAGES[event.error] ?? `Speech error: ${event.error}`))
    }
    recognition.onend = () => finish()

    try {
      recognition.start()
    } catch (error) {
      finish(new SpeechCaptureError('start-failed', `Could not start listening: ${String(error)}`))
      return
    }
    timer = window.setTimeout(() => recognition.stop(), maxDurationMs)
  })

  return {
    result,
    stop: () => {
      if (!settled) recognition.stop()
    },
  }
}
