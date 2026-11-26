import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
import { existsSync } from 'node:fs'

/**
 * The Quest browser loads this app from https://<MAC_IP>:5173. A direct fetch() from
 * that page to http://<MAC_IP>:11434 would be blocked as mixed content, so every AI call
 * goes to the same HTTPS origin (/api/ollama, /api/muse) and Vite forwards it to the
 * local model servers on this Mac over plain HTTP.
 *
 * OLLAMA_URL / MUSE_URL are server-side only (no VITE_ prefix), so they are never shipped
 * to the browser. Each URL includes the OpenAI-compatible base path, usually /v1.
 */
function aiProxy(prefix: string, upstream: string): ProxyOptions {
  const url = new URL(upstream)
  const basePath = url.pathname.replace(/\/+$/, '')
  return {
    target: url.origin,
    changeOrigin: true,
    secure: false,
    // Local models can take a while on the first (cold) request.
    timeout: 180_000,
    proxyTimeout: 180_000,
    rewrite: (path) => basePath + path.slice(prefix.length),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        // Ollama rejects browser origins it does not know (HTTP 403). The request now comes
        // from the Vite server itself, so drop the browser's Origin/Referer headers.
        proxyReq.removeHeader('origin')
        proxyReq.removeHeader('referer')
      })
      proxy.on('error', (err, _req, res) => {
        const target = `${url.origin}${basePath}`
        console.error(`[ai-proxy] ${prefix} -> ${target} failed: ${err.message}`)
        if (res && 'writeHead' in res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              error: {
                message: `Proxy could not reach ${target} (${err.message}). Is the model server running?`,
              },
            }),
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ollamaUrl = env.OLLAMA_URL || 'http://127.0.0.1:11434/v1'
  const museUrl = env.MUSE_URL || 'http://127.0.0.1:8000/v1'
  // Prefer a Homebrew mkcert (brew install mkcert); otherwise the plugin downloads one from GitHub.
  const localMkcert = env.MKCERT_PATH || ['/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert'].find((p) => existsSync(p))

  return {
    plugins: [react(), mkcert(localMkcert ? { mkcertPath: localMkcert } : {})],
    resolve: {
      // drei's stats-gl and the desktop XR emulator ship their own three.js copies; use one.
      dedupe: ['three', 'react', 'react-dom'],
    },
    build: {
      // three.js + the optional desktop XR emulator are large; they are split into lazy chunks.
      chunkSizeWarningLimit: 2500,
    },
    define: {
      __AI_PROXY_TARGETS__: JSON.stringify({ ollama: ollamaUrl, muse: museUrl }),
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/ollama': aiProxy('/api/ollama', ollamaUrl),
        '/api/muse': aiProxy('/api/muse', museUrl),
      },
    },
    preview: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/ollama': aiProxy('/api/ollama', ollamaUrl),
        '/api/muse': aiProxy('/api/muse', museUrl),
      },
    },
  }
})
