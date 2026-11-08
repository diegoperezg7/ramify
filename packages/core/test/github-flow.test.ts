// Merging all the way to GitHub, with a real remote (a bare repository) and a fake gh that squash-merges into it.
import './isolate.ts'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, EngineError } from '../src/engine.ts'

const BIN = resolve(import.meta.dirname, '../../../ramify')
const T = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-gh-')))
const ORIGIN = join(T, 'origin.git')
const REPO = join(T, 'shop')
const OTHER = join(T, 'teammate') // someone else pushing to GitHub
const GH = join(T, 'gh-state')
const env = {
  RAMIFY_ROOT: join(T, 'wts'), GH_STATE: GH, ORIGIN,
  PATH: `${join(T, 'bin')}:${process.env.PATH}`,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...env } }).toString().trim()
const remoteHead = (branch: string) => git(REPO, 'ls-remote', ORIGIN, `refs/heads/${branch}`).split('\t')[0]
const prs = (list: object[]) => writeFileSync(join(GH, 'prs.json'), JSON.stringify(list))
const ghLog = () => (existsSync(join(GH, 'log')) ? readFileSync(join(GH, 'log'), 'utf8') : '')
/** A commit on main pushed by someone else: local main falls behind GitHub. */
const teammatePushes = (msg: string) => {
  git(OTHER, 'pull', '-q', '--ff-only')
  git(OTHER, 'commit', '-q', '--allow-empty', '-m', msg)
  git(OTHER, 'push', '-q', 'origin', 'main')
}
const branchWithWork = async (engine: Engine, branch: string) => {
  const { path } = await engine.create(REPO, { branch, agent: '' })
  writeFileSync(join(path, `${branch.replace('/', '-')}.txt`), 'work\n')
  git(path, 'add', '.')
  git(path, 'commit', '-qm', `work on ${branch}`)
  return { path, tip: git(path, 'rev-parse', 'HEAD') }
}

// gh: `pr list` prints prs.json; `pr ready` and `pr merge` are logged; `pr merge` squashes the branch into
// origin's main, as GitHub does, and marks the pull request merged at the head it had.
const FAKE_GH = `#!/bin/bash
echo "$*" >> "$GH_STATE/log"
case "$1 $2" in
  "pr list") cat "$GH_STATE/prs.json" ;;
  "pr ready") ;;
  "pr merge")
    branch=$(sed -n 's/.*"headRefName":"\\([^"]*\\)".*/\\1/p' "$GH_STATE/prs.json")
    tmp=$(mktemp -d); git clone -q "$ORIGIN" "$tmp/c" && cd "$tmp/c" || exit 1
    git merge -q --squash "origin/$branch" && git commit -qm "$branch (#$3)" && git push -q origin main || exit 1
    sed -i.bak 's/"OPEN"/"MERGED"/' "$GH_STATE/prs.json" ;;
  *) exit 1 ;;
esac
`

describe('merge into main, all the way to GitHub', { skip: process.platform === 'win32' && 'fake gh is a bash script' }, () => {
  before(() => {
    mkdirSync(join(T, 'bin')); mkdirSync(GH)
    writeFileSync(join(T, 'bin', 'gh'), FAKE_GH); chmodSync(join(T, 'bin', 'gh'), 0o755)
    prs([])
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', ORIGIN])
    execFileSync('git', ['clone', '-q', ORIGIN, REPO], { stdio: 'ignore' }) // empty: git warns
    git(REPO, 'checkout', '-q', '-b', 'main')
    writeFileSync(join(REPO, 'a.txt'), 'hi\n')
    git(REPO, 'add', '.')
    git(REPO, 'commit', '-qm', 'init')
    git(REPO, 'push', '-q', '-u', 'origin', 'main')
    execFileSync('git', ['clone', '-q', ORIGIN, OTHER])
  })
  after(() => rmSync(T, { recursive: true, force: true }))

  it('sees main fall behind GitHub (fetching on its own) and brings it up, fast-forward only', async () => {
    teammatePushes('from a teammate')
    const engine = new Engine({ bin: BIN, env })
    const h = await engine.health(REPO)
    assert.deepEqual(h.sync, { upstream: 'origin/main', behind: 1, ahead: 0 })
    assert.match(await engine.updateBase(REPO), /main ← origin\/main/)
    assert.equal(git(REPO, 'rev-parse', 'main'), remoteHead('main'))
    assert.deepEqual((await engine.health(REPO)).sync, { upstream: 'origin/main', behind: 0, ahead: 0 })
  })

  it('merges a branch with an open pull request on GitHub (squash), deletes its remote branch, and main here equals origin/main', async () => {
    const engine = new Engine({ bin: BIN, env })
    const { path, tip } = await branchWithWork(engine, 'feat/pr')
    git(path, 'push', '-q', 'origin', 'feat/pr')
    prs([{ number: 7, url: 'https://github.com/acme/shop/pull/7', state: 'OPEN', isDraft: true, title: 'pr', headRefName: 'feat/pr', headRefOid: tip }])
    teammatePushes('meanwhile on GitHub') // main here is stale when the merge starts
    const said = await engine.merge(REPO, path)
    assert.match(said, /^merged on GitHub: #7 \(squash\)$/m)
    assert.match(said, /^feat\/pr deleted on GitHub$/m)
    assert.match(ghLog(), /^pr ready 7$/m) // a draft leaves draft first
    assert.match(ghLog(), new RegExp(`^pr merge 7 --squash --match-head-commit ${tip}$`, 'm'))
    assert.equal(remoteHead('feat/pr'), '')
    assert.equal(git(REPO, 'rev-parse', 'main'), remoteHead('main'))
    assert.equal(git(REPO, 'log', '-1', '--format=%s', 'main'), 'feat/pr (#7)')
    assert.equal(git(REPO, 'status', '--porcelain'), '')
  })

  it('counts a squash-merged branch as merged and removes its worktree, then its branch (no "used by worktree")', async () => {
    const engine = new Engine({ bin: BIN, env })
    const b = (await engine.health(REPO)).branches.find((x) => x.branch === 'feat/pr')
    assert.ok(b && b.ahead > 0, 'none of its commits are in main: it went in squashed')
    assert.equal(b.merged, true)
    const path = b.path
    await engine.remove(REPO, path, false)
    assert.equal(existsSync(path), false)
    assert.equal(git(REPO, 'branch', '--list', 'feat/pr'), '')
  })

  it('does not count it merged when the branch moved after its pull request', async () => {
    const engine = new Engine({ bin: BIN, env })
    const { path, tip } = await branchWithWork(engine, 'feat/moved')
    prs([{ number: 8, url: 'u', state: 'MERGED', isDraft: false, title: 't', headRefName: 'feat/moved', headRefOid: tip }])
    git(path, 'commit', '-q', '--allow-empty', '-m', 'after the merge')
    assert.equal((await engine.health(REPO)).branches.find((x) => x.branch === 'feat/moved')?.merged, false)
    await assert.rejects(engine.remove(REPO, path, false), EngineError)
    assert.equal(existsSync(path), true)
    await engine.remove(REPO, path, true)
    prs([])
  })

  it('without a pull request: merges here, then pushes main', async () => {
    const engine = new Engine({ bin: BIN, env })
    const { path, tip } = await branchWithWork(engine, 'feat/local')
    const said = await engine.merge(REPO, path)
    assert.match(said, /^pushed to origin\/main$/m)
    assert.equal(git(REPO, 'rev-parse', 'main'), remoteHead('main'))
    git(REPO, 'merge-base', '--is-ancestor', tip, 'main') // throws if the branch is not in main
  })

  it('refuses when main and GitHub went different ways, and changes nothing', async () => {
    const engine = new Engine({ bin: BIN, env })
    const { path } = await branchWithWork(engine, 'feat/diverged')
    git(REPO, 'commit', '-q', '--allow-empty', '-m', 'only here')
    teammatePushes('only there')
    const before = git(REPO, 'rev-parse', 'main')
    await assert.rejects(engine.merge(REPO, path), /went different ways/)
    assert.equal(git(REPO, 'rev-parse', 'main'), before)
    await assert.rejects(engine.updateBase(REPO), /went different ways/)
    git(REPO, 'reset', '-q', '--hard', 'origin/main')
  })

  it('keeps a local merge and says so when main cannot be pushed', async () => {
    const engine = new Engine({ bin: BIN, env })
    const { path, tip } = await branchWithWork(engine, 'feat/offline')
    // Fetching still works, pushing does not (a protected branch, no write access).
    git(REPO, 'remote', 'set-url', '--push', 'origin', join(T, 'gone.git'))
    try {
      const said = await engine.merge(REPO, path)
      assert.match(said, /^not pushed to origin\/main: /m)
      git(REPO, 'merge-base', '--is-ancestor', tip, 'main')
    } finally { git(REPO, 'config', '--unset', 'remote.origin.pushurl') }
  })

  it('does not merge when origin cannot be fetched: it would decide against an old copy of GitHub', async () => {
    const engine = new Engine({ bin: BIN, env })
    const { path } = await branchWithWork(engine, 'feat/no-fetch')
    git(REPO, 'remote', 'set-url', 'origin', join(T, 'gone.git'))
    const before = git(REPO, 'rev-parse', 'main')
    try {
      await assert.rejects(engine.merge(REPO, path), (e: Error) => e instanceof EngineError && /origin could not be fetched/.test(e.message))
      assert.equal(git(REPO, 'rev-parse', 'main'), before)
    } finally { git(REPO, 'remote', 'set-url', 'origin', ORIGIN) }
  })

  it('merges into the default branch, and refuses while the main checkout is on another one', async () => {
    const engine = new Engine({ bin: BIN, env })
    const { path } = await branchWithWork(engine, 'feat/default')
    git(REPO, 'checkout', '-q', '-b', 'scratch')
    try {
      // The base is main (origin/HEAD), not the branch the main checkout is on.
      assert.equal((await engine.health(REPO)).base, 'main')
      assert.equal(await engine.defaultBranch(REPO), 'main')
      const before = git(REPO, 'rev-parse', 'scratch')
      await assert.rejects(engine.merge(REPO, path), /the main checkout is on scratch, not on main/)
      await assert.rejects(engine.updateBase(REPO), /the main checkout is on scratch, not on main/)
      assert.equal(git(REPO, 'rev-parse', 'scratch'), before)
    } finally { git(REPO, 'checkout', '-q', 'main'); git(REPO, 'branch', '-q', '-D', 'scratch') }
    await engine.merge(REPO, path)
    assert.match(git(REPO, 'log', '-1', '--format=%s', 'main'), /Merge branch 'feat\/default'/)
  })
})
