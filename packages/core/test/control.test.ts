import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { staleReady, staleWait } from '../src/attention.ts'
import { Engine, gitBash, normPath } from '../src/engine.ts'

const BIN = resolve(import.meta.dirname, '../../../ramify')
const T = normPath(realpathSync(mkdtempSync(join(tmpdir(), 'ramify-control-'))))
const REPO = `${T}/shop`
const env = { RAMIFY_ROOT: `${T}/wts`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { env: { ...process.env, ...env } }).toString()
// The ramify script runs through Git Bash on Windows, as the engine does.
const ramifyIn = (cwd: string, ...a: string[]) => (process.platform === 'win32'
  ? execFileSync(gitBash(), [BIN.replace(/\\/g, '/'), ...a], { cwd, env: { ...process.env, ...env, NO_COLOR: '1' } })
  : execFileSync(BIN, a, { cwd, env: { ...process.env, ...env, NO_COLOR: '1' } })).toString()
const rw = (...a: string[]) => ramifyIn(REPO, ...a).trim().split('\n').pop() ?? ''
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

  it('health carries ready and behind from the list of worktrees', async () => {
    // feat/a has the base since the test above: its agent marks it ready.
    ramifyIn(a, 'ready')
    let list = await engine.worktrees(REPO)
    assert.equal(list.find((w) => w.branch === 'feat/a')?.ready, 'ready')
    assert.equal(list.find((w) => w.branch === 'feat/a')?.behind, 0)
    assert.equal(list.find((w) => w.main)?.ready, null)
    assert.equal(list.find((w) => w.main)?.behind, 0)
    assert.equal((await engine.health(REPO)).branches.find((x) => x.branch === 'feat/a')?.ready, 'ready')
    // The base moves on: the mark goes stale by itself and behind counts the new commit.
    writeFileSync(join(REPO, 'late.ts'), 'z\n')
    git(REPO, 'add', '.')
    git(REPO, 'commit', '-qm', 'chore: late')
    list = await engine.worktrees(REPO)
    assert.equal(list.find((w) => w.branch === 'feat/a')?.ready, 'stale')
    assert.equal(list.find((w) => w.branch === 'feat/a')?.behind, 1)
    const by = Object.fromEntries((await engine.health(REPO)).branches.map((x) => [x.branch, x]))
    assert.equal(by['feat/a'].ready, 'stale')
    assert.equal(by['feat/b'].ready, null)
    assert.equal(by['fix/done'].ready, null)
  })

  it('health carries waiting: ready found a branch marked before it changing the same files', async () => {
    // feat/a brings the late commit in and is ready again; feat/c changes cart.ts too, so it has to wait its turn.
    ramifyIn(a, 'ready')
    const c = rw('new', 'feat/c', '--no-launch', '--no-setup')
    writeFileSync(join(c, 'cart.ts'), 'export const total = 4\n')
    git(c, 'commit', '-qam', 'feat: total 4')
    assert.throws(() => ramifyIn(c, 'ready'), (e: { status?: number }) => e.status === 1)
    const list = await engine.worktrees(REPO)
    assert.equal(list.find((w) => w.branch === 'feat/c')?.ready, 'waiting')
    const by = Object.fromEntries((await engine.health(REPO)).branches.map((x) => [x.branch, x]))
    assert.equal(by['feat/c'].ready, 'waiting')
    assert.equal(by['feat/c'].behind, 0)
    assert.equal(staleWait(by['feat/c']), false) // the base has not moved: nothing to tell yet
    assert.equal(by['feat/a'].ready, 'ready')
  })

  it('after a merge from the app, the other branch marked ready goes stale and is the one to tell', async () => {
    // Two branches finish at once on different files: both are marked ready. A is merged the way the app merges.
    const R = `${T}/queue`
    execFileSync('git', ['init', '-q', '-b', 'main', R])
    writeFileSync(join(R, 'a.ts'), 'a\n')
    writeFileSync(join(R, 'b.ts'), 'b\n')
    git(R, 'add', '.')
    git(R, 'commit', '-qm', 'init')
    const made = (branch: string) => ramifyIn(R, 'new', branch, '--no-launch', '--no-setup').trim().split('\n').pop() ?? ''
    const qa = made('feat/qa')
    const qb = made('feat/qb')
    writeFileSync(join(qa, 'a.ts'), 'a2\n')
    git(qa, 'commit', '-qam', 'a')
    writeFileSync(join(qb, 'b.ts'), 'b2\n')
    git(qb, 'commit', '-qam', 'b')
    ramifyIn(qa, 'ready')
    ramifyIn(qb, 'ready')
    let by = Object.fromEntries((await engine.health(R)).branches.map((x) => [x.branch, x]))
    assert.equal(by['feat/qa'].ready, 'ready')
    assert.equal(by['feat/qb'].ready, 'ready')
    assert.equal(staleReady(by['feat/qb']), false)
    await engine.merge(R, qa)
    by = Object.fromEntries((await engine.health(R)).branches.map((x) => [x.branch, x]))
    assert.equal(by['feat/qb'].ready, 'stale')
    assert.equal(by['feat/qb'].behind, 2) // A's commit and the merge commit: the app merges with --no-ff
    assert.equal(staleReady(by['feat/qb']), true)
    assert.equal(by['feat/qa'].ready, null) // in the base now: out of the queue
    assert.equal(staleReady(by['feat/qa']), false)
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
