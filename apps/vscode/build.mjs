// Bundle the extension and copy the shared web UI and the ramify script into it.
import { build } from 'esbuild'
import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs'

await build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], logLevel: 'warning' })
rmSync('media/ui', { recursive: true, force: true })
cpSync('../../ui/dist', 'media/ui', { recursive: true })
mkdirSync('bin', { recursive: true })
copyFileSync('../../ramify', 'bin/ramify')
chmodSync('bin/ramify', 0o755)
console.log('built dist/, media/ui and bin/')
