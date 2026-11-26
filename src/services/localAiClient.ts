/**
 * OpenAI-compatible client for local models (Ollama or MUSE / any OpenAI-style server).
 *
 * The browser never talks to the model servers directly: requests go to the same HTTPS
 * origin under /api/ollama or /api/muse, and the Vite dev server proxies them to the Mac's
 * local HTTP ports (see vite.config.ts). This avoids mixed-content and CORS failures in
 * Meta Quest Browser.
 */

export type Provider = 'ollama' | 'muse'

export interface ProviderInfo {
  id: Provider
  label: string
  basePath: string
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  ollama: { id: 'ollama', label: 'Ollama', basePath: '/api/ollama' },
  muse: { id: 'muse', label: 'MUSE', basePath: '/api/muse' },
}

export const PROVIDER_ORDER: Provider[] = ['ollama', 'muse']

export function isProvider(value: unknown): value is Provider {
  return value === 'ollama' || value === 'muse'
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export type LocalAiErrorKind = 'network' | 'http' | 'timeout' | 'aborted' | 'parse' | 'empty'

export class LocalAiError extends Error {
  readonly kind: LocalAiErrorKind
  readonly status?: number

  constructor(kind: LocalAiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'LocalAiError'
    this.kind = kind
    this.status = status
  }
}

/** Short, user-facing description of any error thrown by this module (or anything else). */
export function describeAiError(error: unknown): string {
  if (error instanceof LocalAiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

const DEFAULT_TIMEOUT_MS = 120_000

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

async function requestJson<T>(provider: Provider, path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options
  const info = PROVIDERS[provider]
  const controller = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  let response: Response
  try {
    response = await fetch(`${info.basePath}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new LocalAiError('timeout', `${info.label} did not answer within ${Math.round(timeoutMs / 1000)} s.`)
    }
    if (signal?.aborted) {
      throw new LocalAiError('aborted', 'Request cancelled.')
    }
    throw new LocalAiError(
      'network',
      `Could not reach the ${info.label} proxy (${describeAiError(error)}). Is "npm run dev" still running?`,
    )
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }

  const text = await response.text()
  if (!response.ok) {
    throw new LocalAiError('http', `${info.label} returned HTTP ${response.status}: ${extractErrorMessage(text)}`, response.status)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new LocalAiError('parse', `${info.label} sent a response that is not JSON: ${truncate(text, 120)}`)
  }
}

function extractErrorMessage(body: string): string {
  if (!body.trim()) return 'empty response'
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown; detail?: unknown }
    const err = parsed.error
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message
    }
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.detail === 'string') return parsed.detail
  } catch {
    // not JSON, fall through
  }
  return truncate(body, 160)
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

interface ModelsResponse {
  data?: Array<{ id?: string }>
  models?: Array<{ name?: string; model?: string }>
}

/** Lists models via the OpenAI-compatible GET /models endpoint. */
export async function listModels(provider: Provider, signal?: AbortSignal): Promise<string[]> {
  const result = await requestJson<ModelsResponse>(provider, '/models', { timeoutMs: 10_000, signal })
  const ids = new Set<string>()
  for (const entry of result.data ?? []) if (entry.id) ids.add(entry.id)
  for (const entry of result.models ?? []) {
    const name = entry.name ?? entry.model
    if (name) ids.add(name)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export interface ConnectionReport {
  ok: boolean
  latencyMs: number
  models: string[]
  modelAvailable: boolean
  message: string
}

/** Checks that the proxy and model server answer, and whether `model` is installed. */
export async function testConnection(provider: Provider, model: string): Promise<ConnectionReport> {
  const label = PROVIDERS[provider].label
  const started = performance.now()
  try {
    const models = await listModels(provider)
    const latencyMs = Math.round(performance.now() - started)
    const modelAvailable = models.length === 0 || models.some((m) => matchesModel(m, model))
    let message: string
    if (models.length === 0) {
      message = `${label} is reachable (${latencyMs} ms) but listed no models.`
    } else if (modelAvailable) {
      message = `${label} is reachable (${latencyMs} ms). Model "${model}" is available.`
    } else {
      message = `${label} is reachable (${latencyMs} ms), but "${model}" was not found. Pick one of: ${models.slice(0, 6).join(', ')}`
    }
    return { ok: modelAvailable, latencyMs, models, modelAvailable, message }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      models: [],
      modelAvailable: false,
      message: describeAiError(error),
    }
  }
}

/** Ollama lists "llama3.2:latest" while users usually type "llama3.2". */
function matchesModel(listed: string, wanted: string): boolean {
  const a = listed.trim().toLowerCase()
  const b = wanted.trim().toLowerCase()
  return a === b || a === `${b}:latest` || a.split('/').pop() === b
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null }; text?: string }>
}

export interface ChatOptions {
  provider: Provider
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/** POST /chat/completions and return the assistant text with any <think> block removed. */
export async function chatCompletion({
  provider,
  model,
  messages,
  temperature = 0.4,
  maxTokens = 600,
  signal,
}: ChatOptions): Promise<string> {
  if (!model.trim()) {
    throw new LocalAiError('http', `No model selected for ${PROVIDERS[provider].label}. Set one in the overlay.`)
  }
  const result = await requestJson<ChatCompletionResponse>(provider, '/chat/completions', {
    method: 'POST',
    body: { model: model.trim(), messages, temperature, max_tokens: maxTokens, stream: false },
    signal,
  })
  const choice = result.choices?.[0]
  const raw = choice?.message?.content ?? choice?.text ?? ''
  const content = stripReasoning(raw).trim()
  if (!content) {
    throw new LocalAiError('empty', `${PROVIDERS[provider].label} returned an empty answer. Try a different model.`)
  }
  return content
}

/** Removes reasoning traces that some local models (DeepSeek-R1, Qwen3…) put in the content. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '')
}

/**
 * Turns a model answer into a list of short note strings. Accepts a JSON array (also inside
 * a ```json fence or an object like {"notes": [...]}) and falls back to bullet / numbered lines.
 */
export function parseNoteList(raw: string, maxItems: number): string[] {
  const text = stripReasoning(raw).trim()
  const fromJson = tryParseJsonList(text)
  const items = fromJson ?? splitLines(text)
  return items
    .map((item) => cleanNoteText(item))
    .filter((item) => item.length > 0)
    .slice(0, maxItems)
}

function tryParseJsonList(text: string): string[] | null {
  const unfenced = text.replace(/```(?:json)?/gi, '').trim()
  const candidates: string[] = [unfenced]
  const arrayStart = unfenced.indexOf('[')
  const arrayEnd = unfenced.lastIndexOf(']')
  if (arrayStart !== -1 && arrayEnd > arrayStart) candidates.push(unfenced.slice(arrayStart, arrayEnd + 1))
  const objStart = unfenced.indexOf('{')
  const objEnd = unfenced.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) candidates.push(unfenced.slice(objStart, objEnd + 1))

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      const list = toStringList(parsed)
      if (list && list.length > 0) return list
    } catch {
      // try next candidate
    }
  }
  return null
}

function toStringList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const item of value) {
      if (typeof item === 'string') out.push(item)
      else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        const text = obj.text ?? obj.note ?? obj.title ?? obj.step ?? obj.content
        if (typeof text === 'string') out.push(text)
      }
    }
    return out
  }
  if (value && typeof value === 'object') {
    for (const key of ['notes', 'steps', 'items', 'tasks', 'actions']) {
      const nested = (value as Record<string, unknown>)[key]
      if (Array.isArray(nested)) return toStringList(nested)
    }
  }
  return null
}

function splitLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const bulleted = lines.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line))
  if (bulleted.length > 0) return bulleted
  if (lines.length > 1) return lines
  return text.split(/(?<=[.!?])\s+/)
}

function cleanNoteText(item: string): string {
  return item
    .replace(/^\s*([-*•]|\d+[.)]|step\s*\d+[:.)-]?)\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ------------------------------------------------------------------ */
/* Task-level helpers used by the store                               */
/* ------------------------------------------------------------------ */

interface TaskOptions {
  provider: Provider
  model: string
  signal?: AbortSignal
}

export async function thoughtToNotes(thought: string, options: TaskOptions): Promise<string[]> {
  const answer = await chatCompletion({
    ...options,
    temperature: 0.3,
    maxTokens: 400,
    messages: [
      {
        role: 'system',
        content:
          'You turn a spoken brain-dump into sticky notes. Reply with ONLY a JSON array of 1 to 5 strings. ' +
          'Each string is one concise, actionable note of at most 12 words that starts with a verb. ' +
          'No numbering, no markdown, no explanation.',
      },
      { role: 'user', content: thought },
    ],
  })
  const notes = parseNoteList(answer, 5)
  if (notes.length === 0) throw new LocalAiError('parse', 'The model answer contained no usable notes.')
  return notes
}

export async function summarizeBoard(noteTexts: string[], options: TaskOptions): Promise<string> {
  const list = noteTexts.map((text, i) => `${i + 1}. ${text}`).join('\n')
  const answer = await chatCompletion({
    ...options,
    temperature: 0.3,
    maxTokens: 350,
    messages: [
      {
        role: 'system',
        content:
          'You are a focus coach. Summarize the sticky notes into a short action plan. ' +
          'Format: one summary line, then at most 4 lines that each start with "• " and a verb, ordered by priority. ' +
          'At most 60 words in total. Plain text only, no markdown headings.',
      },
      { role: 'user', content: `Sticky notes on my board:\n${list}` },
    ],
  })
  return answer.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/^\s*[-*]\s+/gm, '• ').trim()
}

export async function expandNote(noteText: string, options: TaskOptions): Promise<string[]> {
  const answer = await chatCompletion({
    ...options,
    temperature: 0.3,
    maxTokens: 300,
    messages: [
      {
        role: 'system',
        content:
          'Break the task into exactly 3 quick, concrete sub-steps that can each be done in under 15 minutes. ' +
          'Reply with ONLY a JSON array of 3 strings, each at most 10 words, starting with a verb.',
      },
      { role: 'user', content: noteText },
    ],
  })
  const steps = parseNoteList(answer, 3)
  if (steps.length === 0) throw new LocalAiError('parse', 'The model answer contained no sub-steps.')
  return steps
}
