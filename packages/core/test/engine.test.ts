import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, EngineError, shellQuote } from '../src/engine.ts'

const BIN = resolve(import.meta.dirname, '../../../agent-wt')
const T = realpathSync(mkdtempSync(join(tmpdir(), 'agent-wt-core-')))
const ROOT = join(T, 'wts')
const REPO = join(T, 'shop')
const env = {
  AGENT_WT_ROOT: ROOT,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
}
const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...env } }).toString()
const engine = new Engine({ bin: BIN, env })

before(() => {
  sh(T, 'init', '-q', '-b', 'main', REPO)
  writeFileSync(join(REPO, 'a.txt'), 'hi\n')
  sh(REPO, 'add', '.')
  sh(REPO, 'commit', '-qm', 'init')
})
after(() => rmSync(T, { recursive: true, force: true }))

describe('engine', () => {
  it('finds the main checkout', async () => {
    assert.equal(await engine.mainCheckout(REPO), REPO)
    assert.equal(await engine.mainCheckout(T), null)
  })

  it('creates a worktree without launching and returns the launch command', async () => {
    const c = await engine.create(REPO, { branch: 'feat/x', agent: 'claude', prompt: "fix it's broken" })
    assert.equal(c.path, join(ROOT, 'shop', 'feat-x'))
    assert.match(c.command ?? '', /open .* -a claude -p 'fix it'\\''s broken'$/)
  })

  it('rejects invalid branch names', async () => {
    await assert.rejects(engine.create(REPO, { branch: '--force', agent: '' }), EngineError)
    await assert.rejects(engine.create(REPO, { branch: 'a b', agent: '' }), EngineError)
  })

  it('reports state with owners per branch', async () => {
    const wt = join(ROOT, 'shop', 'feat-x')
    writeFileSync(join(wt, 'b.txt'), 'b\n')
    sh(wt, 'add', '.')
    sh(wt, 'commit', '-qm', 'work')
    const s = await engine.state(REPO)
    assert.equal(s.base, 'main')
    assert.equal(s.worktrees.find((w) => w.branch === 'feat/x')?.agent, 'claude')
    assert.equal(s.commits.find((c) => c.subject === 'work')?.owner, 'feat/x')
    assert.equal(s.commits.find((c) => c.subject === 'init')?.owner, null)
  })

  it('lists files and diffs of a worktree', async () => {
    const wt = join(ROOT, 'shop', 'feat-x')
    writeFileSync(join(wt, 'c.txt'), 'new\n')
    const d = await engine.worktree(REPO, wt)
    assert.deepEqual(d.files.map((f) => [f.file, f.status, f.uncommitted]), [['b.txt', 'A', false], ['c.txt', '?', true]])
    assert.match(await engine.diff(REPO, wt, 'c.txt'), /\+new/)
  })

  it('refuses to merge with uncommitted changes, then merges', async () => {
    const wt = join(ROOT, 'shop', 'feat-x')
    await assert.rejects(engine.merge(REPO, wt), /uncommitted/)
    rmSync(join(wt, 'c.txt'))
    await engine.merge(REPO, wt)
    assert.match(sh(REPO, 'log', '-1', '--format=%s'), /Merge branch 'feat\/x'/)
  })

  it('refuses unknown paths and removes merged worktrees', async () => {
    await assert.rejects(engine.remove(REPO, '/etc', false), /unknown worktree/)
    await engine.remove(REPO, join(ROOT, 'shop', 'feat-x'), false)
    assert.equal((await engine.worktrees(REPO)).length, 1)
  })

  it('discovers repositories from worktree env files', async () => {
    await engine.create(REPO, { branch: 'other', agent: '' })
    assert.deepEqual(engine.discover(), [REPO])
  })

  it('quotes for the shell', () => {
    assert.equal(shellQuote('plain/path-1.2'), 'plain/path-1.2')
    assert.equal(shellQuote("a b'c"), `'a b'\\''c'`)
  })
})

import { agentOf, githubSlug, scanRepos } from '../src/projects.ts'

describe('projects', () => {
  it('recognises agent processes', () => {
    assert.equal(agentOf('/opt/homebrew/bin/claude', 'claude'), 'claude')
    assert.equal(agentOf('node', 'node /opt/homebrew/bin/gemini -i hi'), 'gemini')
    assert.equal(agentOf('node', 'node /usr/lib/node_modules/@github/copilot/index.js'), 'copilot')
    assert.equal(agentOf('node', 'node vite --port 4100'), null)
    assert.equal(agentOf('/bin/zsh', 'zsh'), null)
  })

  it('parses GitHub remotes', () => {
    assert.equal(githubSlug('git@github.com:diego/shop.git'), 'diego/shop')
    assert.equal(githubSlug('https://github.com/diego/shop'), 'diego/shop')
    assert.equal(githubSlug('https://gitlab.com/diego/shop.git'), null)
  })

  it('finds repositories under a folder', () => {
    assert.deepEqual(scanRepos(T, 2), [REPO])
  })
})
