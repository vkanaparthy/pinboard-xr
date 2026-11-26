/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_PROVIDER?: string
  readonly VITE_OLLAMA_MODEL?: string
  readonly VITE_MUSE_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Upstream URLs the Vite proxy forwards to (injected by vite.config.ts, for display only). */
declare const __AI_PROXY_TARGETS__: { ollama: string; muse: string }
