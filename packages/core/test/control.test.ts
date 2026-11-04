import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, gitBash, normPath } from '../src/engine.ts'

const BIN = resolve(import.meta.dirname, '../../../ramify')
const T = normPath(realpathSync(mkdtempSync(join(tmpdir(), 'ramify-control-'))))
const REPO = `${T}/shop`
const env = { RAMIFY_ROOT: `${T}/wts`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { env: { ...process.env, ...env } }).toString()
// The ramify script runs through Git Bash on Windows, as the engine does.
const rw = (...a: string[]) => (process.platform === 'win32'
  ? execFileSync(gitBash(), [BIN.replace(/\\/g, '/'), ...a], { cwd: REPO, env: { ...process.env, ...env, NO_COLOR: '1' } })
  : execFileSync(BIN, a, { cwd: REPO, env: { ...process.env, ...env, NO_COLOR: '1' } })).toString().trim().split('\n').pop() ?? ''
const engine = new Engine({ bin: BIN, env })
let a = ''
let b = ''
let done = ''

before(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', REPO])
  writeFileSync(join(REPO, 'cart.ts'), 'export const total = 1\n')
  git(REPO, 'add', '.')
  git(REPO, 'commit', '-qm', 'init')
  a = rw('new', 'feat/a', '-a', 'claude', '--no-launch', '--no-setup')
  b = rw('new', 'feat/b', '-a', 'codex', '--no-launch', '--no-setup')
  done = rw('new', 'fix/done', '--no-launch', '--no-setup')
  // a and b both change cart.ts; a commits, b leaves it uncommitted.
  writeFileSync(join(a, 'cart.ts'), 'export const total = 2\nexport const tax = 0\n')
  git(a, 'commit', '-qam', 'feat: tax')
  writeFileSync(join(b, 'cart.ts'), 'export const total = 3\n')
  writeFileSync(join(b, 'new.ts'), 'x\n')
  // fix/done is merged into main; then main moves on.
  writeFileSync(join(done, 'readme.md'), 'docs\n')
  git(done, 'add', '.')
  git(done, 'commit', '-qm', 'docs')
  git(REPO, 'merge', '-q', '--no-ff', '-m', "Merge branch 'fix/done'", 'fix/done')
  writeFileSync(join(REPO, 'other.ts'), 'y\n')
  git(REPO, 'add', '.')
  git(REPO, 'commit', '-qm', 'chore: other')
})

describe('control center', () => {
  it('reports each branch: ahead, behind, uncommitted, size and files', async () => {
    const h = await engine.health(REPO)
    const by = Object.fromEntries(h.branches.map((x) => [x.branch, x]))
    assert.equal(h.base, 'main')
    assert.equal(by['feat/a'].ahead, 1)
    assert.equal(by['feat/a'].behind, 3) // docs, its merge and chore
    assert.equal(by['feat/a'].agent, 'claude')
    assert.equal(by['feat/a'].added, 2)
    assert.equal(by['feat/a'].deleted, 1)
    assert.equal(by['feat/b'].uncommitted, 2)
    assert.equal(by['feat/b'].files, 2)
    assert.equal(by['feat/a'].unpushed, null)
  })

  it('warns when two branches change the same file', async () => {
    const by = Object.fromEntries((await engine.health(REPO)).branches.map((x) => [x.branch, x]))
    assert.deepEqual(by['feat/a'].overlaps, ['feat/b'])
    assert.deepEqual(by['feat/b'].overlaps, ['feat/a'])
    assert.deepEqual(by['fix/done'].overlaps, [])
  })

  it('knows a branch whose work is already in the base', async () => {
    const by = Object.fromEntries((await engine.health(REPO)).branches.map((x) => [x.branch, x]))
    assert.equal(by['fix/done'].merged, true)
    assert.equal(by['feat/a'].merged, false)
  })

  it('brings the base into a branch, and refuses with uncommitted work', async () => {
    await engine.updateFromBase(REPO, a)
    const by = Object.fromEntries((await engine.health(REPO)).branches.map((x) => [x.branch, x]))
    assert.equal(by['feat/a'].behind, 0)
    await assert.rejects(engine.updateFromBase(REPO, b), /commit or stash/)
  })

  it('does not open a pull request without a GitHub remote', async () => {
    await assert.rejects(engine.openPr(REPO, a), /no GitHub remote/)
  })

  it('counts commits per day for the contribution grid', async () => {
    const days = await engine.commitDays(REPO, 30)
    const total = Object.values(days).reduce((s, n) => s + n, 0)
    assert.ok(total >= 6, `got ${total}`)
  })

  it('lists the commits of one local day, newest first, and nothing from the next day', async () => {
    const day = new Date(2026, 2, 10) // a fixed past day, local midnight
    const at = (h: number, m: number) => `${Math.floor(new Date(2026, 2, 10, h, m).getTime() / 1000)} +0000`
    const R = `${T}/days`
    execFileSync('git', ['init', '-q', '-b', 'main', R])
    for (const [i, when] of [[1, at(9, 0)], [2, at(23, 59)], [3, at(24, 1)]] as const) {
      writeFileSync(join(R, 'f.txt'), `${i}\n`)
      git(R, 'add', '.')
      execFileSync('git', ['-C', R, 'commit', '-qm', `c${i}`], { env: { ...process.env, ...env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
    }
    const list = await engine.dayCommits(R, Math.floor(day.getTime() / 1000))
    assert.deepEqual(list.map((c) => c.subject), ['c2', 'c1'])
  })
})
