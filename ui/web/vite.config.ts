import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Built into ../dist, which ui/server.py serves. Dev: run `agent-wt ui --port 4999`
// and `npm run dev`; API calls are proxied to it.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4999', headers: { Host: '127.0.0.1:4999' } } } },
})
