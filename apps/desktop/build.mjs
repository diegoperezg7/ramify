// Bundle main + preload with esbuild and copy the prebuilt web UI next to them.
import { build } from 'esbuild'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' }
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' })
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' })
rmSync('renderer', { recursive: true, force: true })
cpSync('../../ui/dist', 'renderer', { recursive: true })

// Content Security Policy for the desktop window: only the app's own files run or load; the page can reach
// nothing on the network (everything goes through IPC), except GitHub avatars.
export const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'",
  "img-src 'self' data: https://avatars.githubusercontent.com", "connect-src 'none'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'",
].join('; ')
const html = readFileSync('renderer/index.html', 'utf8')
writeFileSync('renderer/index.html', html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`))
console.log('built dist/ and renderer/')
