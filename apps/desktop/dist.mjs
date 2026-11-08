// Package for macOS. With a certificate (CSC_LINK, the release workflow) the app is signed with the hardened
// runtime and notarized when APPLE_* are set. Without one it is signed ad hoc: flipping the Electron fuses
// rewrites the binary, and Apple silicon refuses to run a binary whose signature no longer matches.
// A release (RAMIFY_RELEASE=1, set by the release workflow) never falls back to ad hoc: a missing certificate or
// notarization secret stops the build, so nothing unsigned is published as "signed and notarized".
import { spawnSync } from 'node:child_process'

const RELEASE_SECRETS = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
if (process.env.RAMIFY_RELEASE === '1') {
  const missing = RELEASE_SECRETS.filter((k) => !process.env[k])
  if (missing.length) {
    console.error(`release build: missing ${missing.join(', ')}; a release must be signed with a Developer ID and notarized`)
    process.exit(1)
  }
}

const signed = !!process.env.CSC_LINK
// Signed builds sign the .dmg too (scripts/mac-release.sh checks its signature).
const args = ['electron-builder', '--mac', '--publish', 'never', ...(signed ? ['-c.dmg.sign=true'] : ['-c.mac.identity=-', '-c.mac.hardenedRuntime=false'])]
const env = { ...process.env, ...(signed ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }) }
// the release workflow passes the secrets even when they are not set, as empty strings: electron-builder would take an empty
// CSC_LINK for a path (the current folder) and stop with "not a file"
if (!signed) { delete env.CSC_LINK; delete env.CSC_KEY_PASSWORD }
const r = spawnSync('npx', args, { stdio: 'inherit', env })
process.exit(r.status ?? 1)
