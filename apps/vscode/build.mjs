// Bundle the extension and copy the shared web UI and the agent-wt script into it.
import { build } from 'esbuild'
import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs'

await build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], logLevel: 'warning' })
rmSync('media/ui', { recursive: true, force: true })
cpSync('../../ui/dist', 'media/ui', { recursive: true })
mkdirSync('bin', { recursive: true })
copyFileSync('../../agent-wt', 'bin/agent-wt')
chmodSync('bin/agent-wt', 0o755)
console.log('built dist/, media/ui and bin/')
