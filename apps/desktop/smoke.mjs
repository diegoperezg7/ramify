// Starts the packaged app and checks that its interface renders. A dev build cannot catch problems that only
// exist once packaged (Electron fuses, asar, signing): this runs the real thing.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const candidates = {
  darwin: [`release/mac-${process.arch}/Ramify.app/Contents/MacOS/Ramify`, 'release/mac-arm64/Ramify.app/Contents/MacOS/Ramify', 'release/mac/Ramify.app/Contents/MacOS/Ramify'],
  win32: ['release/win-unpacked/Ramify.exe'],
}[process.platform] ?? []
const exe = candidates.find(existsSync)
if (!exe) { console.error('no packaged app found; run npm run dist first'); process.exit(1) }
const userData = mkdtempSync(join(tmpdir(), 'ramify-smoke-'))
const r = spawnSync(exe, [], { env: { ...process.env, RAMIFY_SMOKE_TEST: '1', RAMIFY_USER_DATA: userData }, encoding: 'utf8', timeout: 60_000 })
process.stdout.write(r.stdout ?? '')
if (r.status !== 0) { console.error(`smoke test failed (${r.status ?? r.signal ?? r.error?.message})`); process.exit(1) }
