import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, EngineError, normPath, shellQuote } from '../src/engine.ts'

const BIN = resolve(import.meta.dirname, '../../../ramify')
// Paths as git prints them (on Windows: long names, forward slashes).
const T = normPath(realpathSync(mkdtempSync(join(tmpdir(), 'ramify-core-'))))
const P = (...parts: string[]) => parts.join('/')
const ROOT = P(T, 'wts')
const REPO = P(T, 'shop')
const env = {
  RAMIFY_ROOT: ROOT,
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
    assert.equal(c.path, P(ROOT, 'shop', 'feat-x'))
    assert.match(c.command ?? '', /open .* -a claude -p 'fix it'\\''s broken'$/)
  })

  it('rejects invalid branch names', async () => {
    await assert.rejects(engine.create(REPO, { branch: '--force', agent: '' }), EngineError)
    await assert.rejects(engine.create(REPO, { branch: 'a b', agent: '' }), EngineError)
  })

  it('reports state with owners per branch', async () => {
    const wt = P(ROOT, 'shop', 'feat-x')
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
    const wt = P(ROOT, 'shop', 'feat-x')
    writeFileSync(join(wt, 'c.txt'), 'new\n')
    const d = await engine.worktree(REPO, wt)
    assert.deepEqual(d.files.map((f) => [f.file, f.status, f.uncommitted]), [['b.txt', 'A', false], ['c.txt', '?', true]])
    assert.match(await engine.diff(REPO, wt, 'c.txt'), /\+new/)
  })

  it('refuses to merge with uncommitted changes, then merges', async () => {
    const wt = P(ROOT, 'shop', 'feat-x')
    await assert.rejects(engine.merge(REPO, wt), /uncommitted/)
    rmSync(join(wt, 'c.txt'))
    await engine.merge(REPO, wt)
    assert.match(sh(REPO, 'log', '-1', '--format=%s'), /Merge branch 'feat\/x'/)
  })

  it('a merge whose only conflicts are generated files rebuilds them with the project script', async () => {
    // A folder and worktree root of its own: the discovery tests below scan T and ROOT.
    const T2 = normPath(realpathSync(mkdtempSync(join(tmpdir(), 'ramify-merge-'))))
    const own = new Engine({ bin: BIN, env: { ...env, RAMIFY_ROOT: P(T2, 'wts') } })
    const R = P(T2, 'built')
    sh(T2, 'init', '-q', '-b', 'main', R)
    writeFileSync(join(R, 'a.txt'), 'a\n'); writeFileSync(join(R, 'b.txt'), 'b\n')
    mkdirSync(join(R, 'dist')); writeFileSync(join(R, 'dist', 'out.txt'), 'a\nb\n')
    writeFileSync(join(R, '.gitattributes'), 'dist/** ramify-generated\n')
    mkdirSync(join(R, '.worktree')); writeFileSync(join(R, '.worktree', 'merge.sh'), '#!/bin/bash\ncat a.txt b.txt > dist/out.txt\n')
    sh(R, 'add', '.'); sh(R, 'commit', '-qm', 'init')
    const wt = (await own.create(R, { branch: 'feat/a', agent: '' })).path
    writeFileSync(join(wt, 'a.txt'), 'a2\n'); writeFileSync(join(wt, 'dist', 'out.txt'), 'a2\nb\n')
    sh(wt, 'commit', '-qam', 'a2')
    writeFileSync(join(R, 'b.txt'), 'b2\n'); writeFileSync(join(R, 'dist', 'out.txt'), 'a\nb2\n')
    sh(R, 'commit', '-qam', 'b2')
    assert.match(await own.merge(R, wt), /regenerated: dist\/out.txt/)
    assert.equal(readFileSync(join(R, 'dist', 'out.txt'), 'utf8'), 'a2\nb2\n')
    assert.match(sh(R, 'log', '-1', '--format=%s'), /Merge branch 'feat\/a'/)
    assert.equal(sh(R, 'status', '--porcelain'), '')

    // A conflict in real code is not touched: the merge is undone and the files are named.
    const wt2 = (await own.create(R, { branch: 'feat/c', agent: '' })).path
    writeFileSync(join(wt2, 'a.txt'), 'c\n'); sh(wt2, 'commit', '-qam', 'c')
    writeFileSync(join(R, 'a.txt'), 'main\n'); sh(R, 'commit', '-qam', 'main')
    const head = sh(R, 'rev-parse', 'HEAD')
    await assert.rejects(own.merge(R, wt2), (e: Error) => /merge conflict, nothing was changed/.test(e.message) && /^conflict: a\.txt$/m.test(e.message))
    assert.equal(sh(R, 'rev-parse', 'HEAD'), head)
    assert.equal(existsSync(join(R, '.git', 'MERGE_HEAD')), false)

    // Without the project script, a generated conflict stays a conflict, as before.
    rmSync(join(R, '.worktree', 'merge.sh')); sh(R, 'commit', '-qam', 'no script')
    writeFileSync(join(wt2, 'a.txt'), 'main\n'); sh(wt2, 'commit', '-qam', 'same as main')
    writeFileSync(join(wt2, 'dist', 'out.txt'), 'x\n'); sh(wt2, 'commit', '-qam', 'x')
    writeFileSync(join(R, 'dist', 'out.txt'), 'y\n'); sh(R, 'commit', '-qam', 'y')
    await assert.rejects(own.merge(R, wt2), /^conflict: dist\/out\.txt$/m)
    rmSync(T2, { recursive: true, force: true })
  })

  it('refuses unknown paths and removes merged worktrees', async () => {
    await assert.rejects(engine.remove(REPO, '/etc', false), /unknown worktree/)
    await engine.remove(REPO, P(ROOT, 'shop', 'feat-x'), false)
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

describe('engine edge cases', () => {
  it('lists files with spaces, accents and renames, and diffs them', async () => {
    const c = await engine.create(REPO, { branch: 'files', agent: '' })
    writeFileSync(join(c.path, 'con espacio.txt'), 'x\n')
    writeFileSync(join(c.path, 'año.txt'), 'y\n')
    sh(c.path, 'add', '.')
    sh(c.path, 'commit', '-qm', 'files')
    sh(c.path, 'mv', 'a.txt', 'renamed.txt')
    const d = await engine.worktree(REPO, c.path)
    const names = d.files.map((f) => f.file)
    assert.ok(names.includes('con espacio.txt') && names.includes('año.txt'))
    assert.ok(!names.some((n) => n.includes('=>')))
    assert.ok(d.files.find((f) => f.file === 'renamed.txt')?.uncommitted)
    assert.match(await engine.diff(REPO, c.path, 'con espacio.txt'), /\+x/)
  })

  it('rejects agent names that are not plain words', async () => {
    await assert.rejects(engine.create(REPO, { branch: 'evil', agent: 'x;rm -rf /' }), EngineError)
    assert.throws(() => engine.launchCommand('/tmp', '$(id)'), EngineError)
  })
})

describe('untrusted repositories', () => {
  it('never runs commands from a repository config (fsmonitor, hooks, external diff)', async () => {
    const { hardenedGitEnv } = await import('../src/engine.ts')
    const dir = P(T, 'evil')
    sh(T, 'init', '-q', '-b', 'main', dir)
    writeFileSync(join(dir, 'f'), 'a\n')
    sh(dir, 'add', '.')
    sh(dir, 'commit', '-qm', 'i')
    const marker = (n: string) => join(T, `pwned-${n}`)
    sh(dir, 'config', 'core.fsmonitor', `touch '${marker('fsmonitor')}'; false`)
    sh(dir, 'config', 'diff.external', `sh -c "touch '${marker('diff')}'"`)
    writeFileSync(join(dir, 'f'), 'b\n')
    const evil = new Engine({ bin: BIN, env })
    assert.ok(await evil.mainCheckout(dir))
    execFileSync('git', ['-C', dir, 'status', '--porcelain'], { env: hardenedGitEnv({ ...process.env, ...env }) })
    await evil.diff(dir, dir, 'f').catch(() => {})
    assert.ok(!existsSync(marker('fsmonitor')), 'fsmonitor ran')
    assert.ok(!existsSync(marker('diff')), 'external diff ran')
  })
})

describe('folders from links', () => {
  it('names the git settings that would run programs, reading the config as text', async () => {
    const { riskyGitConfig } = await import('../src/engine.ts')
    const dir = P(T, 'risky')
    sh(T, 'init', '-q', '-b', 'main', dir)
    assert.deepEqual(riskyGitConfig(dir), [])
    sh(dir, 'config', 'filter.evil.clean', 'touch pwned')
    sh(dir, 'config', 'diff.x.textconv', 'cat')
    assert.deepEqual(riskyGitConfig(dir).sort(), ['diff.textconv', 'filter.clean'])
  })
})
