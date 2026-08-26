import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Three backends, kept explicitly separate (see src/lib/configApi.ts,
// src/lib/voiceApi.ts, src/lib/authApi.ts) — this proxy just routes each
// path prefix to the right one in dev. In production, nginx.conf does the
// equivalent routing.
const VOICE_API = process.env.VITE_VOICE_API ?? 'http://localhost:3001'
const CONFIG_API = process.env.VITE_CONFIG_API ?? 'http://localhost:8000'
const AUTH_API = process.env.VITE_AUTH_API ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Agent-bridge config/memory dashboard API
      '/api': {
        target: CONFIG_API,
        changeOrigin: true,
      },
      // Voice bot REST (integrations, scheduling, ambient, Discord meetings)
      '/integrations': {
        target: VOICE_API,
        changeOrigin: true,
      },
      '/health': {
        target: VOICE_API,
        changeOrigin: true,
      },
      // Voice bot WebSocket (live transcript / audio signaling)
      '/ws': {
        target: VOICE_API,
        ws: true,
      },
      // auth-service (org registration, login, staff, tool config) — no
      // /api prefix, that's already config-api's namespace above.
      '/auth': {
        target: AUTH_API,
        changeOrigin: true,
      },
      '/orgs': {
        target: AUTH_API,
        changeOrigin: true,
      },
      '/.well-known': {
        target: AUTH_API,
        changeOrigin: true,
      },
    },
  },
})
