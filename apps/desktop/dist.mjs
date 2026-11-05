// Package for macOS. With a certificate (CSC_LINK, the release workflow) the app is signed with the hardened
// runtime and notarized when APPLE_* are set. Without one it is signed ad hoc: flipping the Electron fuses
// rewrites the binary, and Apple silicon refuses to run a binary whose signature no longer matches.
import { spawnSync } from 'node:child_process'

const signed = !!process.env.CSC_LINK
const args = ['electron-builder', '--mac', '--publish', 'never', ...(signed ? [] : ['-c.mac.identity=-', '-c.mac.hardenedRuntime=false'])]
const env = { ...process.env, ...(signed ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }) }
// the release workflow passes the secrets even when they are not set, as empty strings: electron-builder would take an empty
// CSC_LINK for a path (the current folder) and stop with "not a file"
if (!signed) { delete env.CSC_LINK; delete env.CSC_KEY_PASSWORD }
const r = spawnSync('npx', args, { stdio: 'inherit', env })
process.exit(r.status ?? 1)
