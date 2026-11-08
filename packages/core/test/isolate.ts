// Imported first by every test that runs git: the developer's own ~/.gitconfig and the system config (hooks,
// signing, init.defaultBranch, credential helpers) stay out, so a test means the same on every machine.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const empty = join(mkdtempSync(join(tmpdir(), 'ramify-gitconfig-')), 'gitconfig')
writeFileSync(empty, '')
process.env.GIT_CONFIG_GLOBAL = empty
process.env.GIT_CONFIG_NOSYSTEM = '1'
