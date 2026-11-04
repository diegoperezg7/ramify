// Bundle main + preload with esbuild and copy the prebuilt web UI next to them.
import { build } from 'esbuild'
import { cpSync, rmSync } from 'node:fs'

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' }
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' })
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' })
rmSync('renderer', { recursive: true, force: true })
cpSync('../../ui/dist', 'renderer', { recursive: true })
console.log('built dist/ and renderer/')
