import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, mergedBranchName, normPath } from '../src/engine.ts'

const BIN = resolve(import.meta.dirname, '../../../ramify')
const T = normPath(realpathSync(mkdtempSync(join(tmpdir(), 'ramify-timeline-'))))
const REPO = `${T}/shop`
const base = { RAMIFY_ROOT: `${T}/wts`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
const now = Math.floor(Date.now() / 1000)
const ago = (d: number) => `${now - d * 86400} +0000`
const git = (when: number, ...a: string[]) => execFileSync('git', ['-C', REPO, ...a], { env: { ...process.env, ...base, GIT_AUTHOR_DATE: ago(when), GIT_COMMITTER_DATE: ago(when) } }).toString()
const commit = (when: number, file: string, msg: string) => { writeFileSync(join(REPO, file), `${msg}\n`); git(when, 'add', '.'); git(when, 'commit', '-qm', msg) }

before(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', REPO])
  commit(40, 'a.txt', 'init')
  // stale: forked 30 days ago, untouched since 25
  git(30, 'checkout', '-qb', 'old/spike')
  commit(25, 'spike.txt', 'spike')
  git(25, 'checkout', '-q', 'main')
  // merged and deleted: feat/login, merged 10 days ago
  git(20, 'checkout', '-qb', 'feat/login')
  commit(15, 'login.txt', 'login form')
  commit(12, 'login2.txt', 'magic links')
  git(10, 'checkout', '-q', 'main')
  git(10, 'merge', '--no-ff', '-q', '-m', "Merge branch 'feat/login'", 'feat/login')
  git(10, 'branch', '-D', 'feat/login')
  // merged and kept: fix/cart
  git(8, 'checkout', '-qb', 'fix/cart')
  commit(6, 'cart.txt', 'round totals')
  git(5, 'checkout', '-q', 'main')
  git(5, 'merge', '--no-ff', '-q', '-m', "Merge branch 'fix/cart'", 'fix/cart')
  // active: feat/search, commits 2 days ago
  git(3, 'checkout', '-qb', 'feat/search')
  commit(2, 'search.txt', 'search box')
  git(2, 'checkout', '-q', 'main')
  commit(1, 'readme.txt', 'readme')
})

describe('timeline', () => {
  it('names merged branches from git and GitHub merge subjects', () => {
    assert.equal(mergedBranchName("Merge branch 'feat/login'"), 'feat/login')
    assert.equal(mergedBranchName("Merge branch 'feat/x' into main"), 'feat/x')
    assert.equal(mergedBranchName('Merge pull request #12 from me/fix-cart'), 'fix-cart')
    assert.equal(mergedBranchName("Merge remote-tracking branch 'origin/dev'"), 'dev')
    assert.equal(mergedBranchName('Release 1.0'), null)
  })

  it('shows live, stale, merged and merged-then-deleted branches with their forks and merges', async () => {
    const engine = new Engine({ bin: BIN, env: base })
    const tl = await engine.timeline(REPO, 0)
    const by = Object.fromEntries(tl.branches.map((b) => [b.name, b]))
    assert.equal(tl.base, 'main')
    assert.deepEqual(Object.keys(by).sort(), ['feat/login', 'feat/search', 'fix/cart', 'old/spike'])
    assert.equal(by['feat/search'].status, 'active')
    assert.equal(by['old/spike'].status, 'stale')
    assert.equal(by['fix/cart'].status, 'merged')
    assert.equal(by['fix/cart'].exists, true)
    assert.equal(by['feat/login'].status, 'merged')
    assert.equal(by['feat/login'].exists, false)
    assert.deepEqual(by['feat/login'].commits.map((c) => c.subject), ['login form', 'magic links'])
    assert.ok(by['feat/login'].merge && Math.abs(by['feat/login'].merge.time - (now - 10 * 86400)) < 5)
    assert.ok(by['feat/search'].fork.time < by['feat/search'].commits[0].time)
    // Newest activity first.
    assert.equal(tl.branches[0].name, 'feat/search')
  })

  it('leaves out merged branches older than the range, never the open ones', async () => {
    const engine = new Engine({ bin: BIN, env: base })
    const names = (await engine.timeline(REPO, 7)).branches.map((b) => b.name).sort()
    assert.deepEqual(names, ['feat/search', 'fix/cart', 'old/spike'])
  })
})
