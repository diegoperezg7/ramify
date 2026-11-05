// Bugs confirmed in the review of 2026-11-05. Each test states the behaviour the code should have and fails today,
// so it is marked `todo`: the run reports it without failing. Drop the `todo` when its fix lands: the test then
// guards against the bug coming back.
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SessionLog, sessionsCsv, claudeContext, type LiveSession, type Resolved } from '../src/activity.ts'
import { Engine, riskyGitConfig } from '../src/engine.ts'
import { withoutBlock } from '../src/setup.ts'
import type { AgentSession } from '../src/types.ts'

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(ROOT_DIR, 'ramify')
const T = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-review-')))
after(() => rmSync(T, { recursive: true, force: true }))

const ID = ['-c', 'user.email=t@t', '-c', 'user.name=t']
const git = (cwd: string, ...args: string[]) => execFileSync('git', [...ID, ...args], { cwd, encoding: 'utf8' })
let n = 0
/** A repository with one commit in a fresh folder of its own; `at` names the folder (default: a unique one). */
function repo(at = join(T, `r${++n}`)): string {
  mkdirSync(at, { recursive: true })
  git(at, 'init', '-q', '-b', 'main')
  git(at, 'commit', '-q', '--allow-empty', '-m', 'init')
  return at
}
/** Runs the CLI with its own worktree root under the test folder. */
function cli(cwd: string, args: string[], input?: string) {
  return spawnSync('bash', [BIN, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, RAMIFY_ROOT: join(T, 'wts') } })
}

describe('CLI (ramify)', () => {
  it('ramify ls does not run code from a PORT line of a .worktree.env shipped in a cloned repo', () => {
    const up = repo()
    const mark = join(T, 'pwned-ls')
    writeFileSync(join(up, '.worktree.env'), `PORT=PORT_MIN[$(touch ${mark})]\n`)
    git(up, 'add', '.worktree.env')
    git(up, 'commit', '-q', '-m', 'env')
    const clone = join(T, `clone${++n}`)
    execFileSync('git', ['clone', '-q', up, clone])
    cli(clone, ['ls'])
    assert.equal(existsSync(mark), false)
  })

  it('ramify ls --json keeps the main checkout main whatever PORT says', () => {
    const r = repo()
    writeFileSync(join(r, '.worktree.env'), 'PORT=1,"main":false\n')
    const list = JSON.parse(cli(r, ['ls', '--json']).stdout) as { path: string; main: boolean; port: unknown }[]
    const main = list.find((w) => realpathSync(w.path) === realpathSync(r))!
    assert.equal(main.main, true)
  })

  it('hook create gives two repositories with the same folder name worktrees of their own', () => {
    const a = repo(join(T, 'x', 'app'))
    const b = repo(join(T, 'y', 'app'))
    const pa = cli(a, ['hook', 'create'], JSON.stringify({ name: 'feat', cwd: a })).stdout.trim().split('\n').pop()!
    const pb = cli(b, ['hook', 'create'], JSON.stringify({ name: 'feat', cwd: b })).stdout.trim().split('\n').pop()!
    assert.ok(pa && pb)
    const owner = (p: string) => realpathSync(join(git(p, 'rev-parse', '--git-common-dir').trim().replace(/^(?!\/)/, `${p}/`), '..'))
    assert.equal(owner(pb), realpathSync(b))
  })

  it('the guard stops commits on the shared branch however git is called, and edits of .git/config', () => {
    const r = repo()
    const guard = (input: object) => cli(r, ['hook', 'guard'], JSON.stringify({ cwd: r, ...input })).stdout
    const commit = 'commit'
    for (const command of [`/usr/bin/git ${commit} -m x`, `bash -c "git ${commit} -m x"`, `git --no-pager ${commit} -m x`, 'git config ramify.allowMain true']) {
      assert.match(guard({ tool_name: 'Bash', tool_input: { command } }), /deny/, command)
    }
    assert.match(guard({ tool_name: 'Edit', tool_input: { file_path: join(r, '.git', 'config') } }), /deny/)
  })

  it('hook create does not hand out a worktree another conversation is still setting up, and frees a failed name', () => {
    const r = repo()
    const name = r.split('/').pop()!
    // Another conversation is midway: its folder exists (git worktree add ran), its claim is still there.
    mkdirSync(join(T, 'wts', name, '.claims', 'feat-pay'), { recursive: true })
    mkdirSync(join(T, 'wts', name, 'feat-pay'), { recursive: true })
    const got = cli(r, ['hook', 'create'], JSON.stringify({ name: 'feat-pay', cwd: r, session_id: 'B' })).stdout.trim().split('\n').pop()!
    assert.notEqual(got, join(T, 'wts', name, 'feat-pay'))
    assert.equal(git(got, 'branch', '--show-current').trim(), 'feat/pay-2')
    assert.match(readFileSync(join(got, '.worktree.env'), 'utf8'), /^WT_SESSION=B$/m)
    // A name git refuses: create stops, and its claim does not stay behind.
    cli(r, ['hook', 'create'], JSON.stringify({ name: 'bad..name', cwd: r, session_id: 'C' }))
    assert.equal(existsSync(join(T, 'wts', name, '.claims', 'worktree-bad..name')), false)
  })

  it('worktrees made at the same time get different ports', async () => {
    const r = repo()
    const root = join(T, 'wts-ports')
    const make = (b: string) => new Promise<void>((done) => {
      execFile('bash', [BIN, 'new', b, '--no-launch'], { cwd: r, env: { ...process.env, RAMIFY_ROOT: root } }, () => done())
    })
    await Promise.all(['p1', 'p2', 'p3', 'p4'].map(make))
    const name = r.split('/').pop()!
    const ports = ['p1', 'p2', 'p3', 'p4'].map((b) => /^PORT=(\d+)$/m.exec(readFileSync(join(root, name, b, '.worktree.env'), 'utf8'))?.[1])
    assert.equal(new Set(ports).size, 4, ports.join(' '))
  })

  it('ramify move leaves the changes in place when it cannot create the worktree', () => {
    const r = repo()
    writeFileSync(join(r, 'f.txt'), 'work\n')
    mkdirSync(join(T, 'wts', r.split('/').pop()!, 'feat-m'), { recursive: true })
    const res = cli(r, ['move', 'feat-m'])
    assert.notEqual(res.status, 0)
    assert.match(git(r, 'status', '--porcelain'), /f\.txt/)
  })
})

describe('session history and export', () => {
  const live = (key: string, start: number): LiveSession & Resolved =>
    ({ key, agent: 'claude', host: 'Ghostty', via: 'terminal', inferred: false, cwd: '/r', start, state: 'idle', repo: '/r', branch: 'main', github: null })

  it('a session the user closed stays closed after "clear history"', () => {
    const log = new SessionLog()
    log.update([live('pid:7', 1000)], 2000)
    assert.ok(log.close(log.sessions[0].id, 3000))
    log.clear()
    const r = log.update([live('pid:7', 1000)], 4000)
    assert.equal(r.started.length, 0)
  })

  it('the CSV export neutralises cells a spreadsheet would run as formulas', () => {
    const s: AgentSession = {
      id: '1', key: 'pid:1', agent: 'claude', host: 'Ghostty', via: 'terminal', inferred: false, cwd: '/r', repo: '/r',
      branch: '=HYPERLINK("https://example.invalid","x")', github: null, start: 0, end: 60_000, lastSeen: 60_000,
    }
    const row = sessionsCsv([s], 60_000).split('\n')[1]
    assert.doesNotMatch(row, /(^|,)"?=/)
  })

  it('a session id with path segments does not lead the scanner out of ~/.claude/projects', () => {
    const home = join(T, 'home')
    mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(home, '.claude', 'projects', 'p'), { recursive: true })
    mkdirSync(join(T, 'elsewhere'), { recursive: true })
    writeFileSync(join(T, 'elsewhere', 'x.jsonl'), JSON.stringify({ cwd: '/planted' }) + '\n')
    // From ~/.claude/projects/p up to the test folder (p, projects, .claude, home), then into a folder outside.
    const sessionId = '../../../../elsewhere/x'
    writeFileSync(join(home, '.claude', 'sessions', '9.json'), JSON.stringify({ pid: 9, sessionId, cwd: '/Users/d', status: 'busy' }))
    assert.equal(claudeContext(9, home)?.cwd, '/Users/d')
  })
})

describe('git settings of a folder opened from a link', () => {
  it('sees risky settings in the old section syntax, in included files and in the signing program', () => {
    const check = (config: string, extra?: [string, string]) => {
      const r = repo()
      if (extra) writeFileSync(join(r, extra[0]), extra[1])
      writeFileSync(join(r, '.git', 'config'), `[core]\n\trepositoryformatversion = 0\n${config}`)
      return riskyGitConfig(r)
    }
    assert.notDeepEqual(check('[filter.evil]\n\tclean = touch pwned\n'), [])
    assert.notDeepEqual(check('[include]\n\tpath = ../x.cfg\n', ['x.cfg', '[filter "f"]\n\tclean = touch pwned\n']), [])
    assert.notDeepEqual(check('[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /tmp/evil\n'), [])
  })
})

describe('merging generated files', () => {
  it('runs only the merge.sh the base has, never one the merged branch brings', async () => {
    const env = { RAMIFY_ROOT: join(T, 'wts-merge'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    const own = new Engine({ bin: BIN, env })
    const R = repo()
    git(R, 'config', 'core.autocrlf', 'false')
    mkdirSync(join(R, 'dist')); writeFileSync(join(R, 'dist', 'out.txt'), 'a\n')
    writeFileSync(join(R, '.gitattributes'), 'dist/** ramify-generated\n')
    git(R, 'add', '.'); git(R, 'commit', '-qm', 'base')
    const wt = (await own.create(R, { branch: 'feat/evil', agent: '' })).path
    const mark = join(T, 'pwned-merge')
    mkdirSync(join(wt, '.worktree')); writeFileSync(join(wt, '.worktree', 'merge.sh'), `#!/bin/bash\ntouch ${mark}\n`)
    writeFileSync(join(wt, 'dist', 'out.txt'), 'branch\n')
    git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'script and output')
    writeFileSync(join(R, 'dist', 'out.txt'), 'base\n'); git(R, 'commit', '-qam', 'output on base')
    await assert.rejects(own.merge(R, wt), /merge conflict/)
    assert.equal(existsSync(mark), false)
  })
})

describe('a file named like a revision', () => {
  it('a repository with a file called HEAD still lists its changes', async () => {
    const own = new Engine({ bin: BIN, env: { RAMIFY_ROOT: join(T, 'wts-head') } })
    const R = repo()
    writeFileSync(join(R, 'HEAD'), 'x\n'); writeFileSync(join(R, 'a.txt'), 'a\n')
    git(R, 'add', '.'); git(R, 'commit', '-qm', 'files')
    writeFileSync(join(R, 'a.txt'), 'changed\n')
    const d = await own.worktree(R, R)
    assert.deepEqual(d.files.map((f) => f.file), ['a.txt'])
  })
})

describe('setup undo', () => {
  it('removing a block whose end line the user deleted keeps the rest of the file', () => {
    const text = ['export A=1', '# >>> ramify >>>', 'export PATH=x', 'alias ll="ls -l"', 'export B=2'].join('\n')
    const out = withoutBlock(text, '# >>> ramify >>>', '# <<< ramify <<<')
    assert.match(out, /export B=2/)
  })
})

describe('browser host server (ui/server.py)', () => {
  it('takes its token from the environment, not from a command-line argument every user can read', { skip: process.platform === 'win32' }, async () => {
    const r = repo()
    const token = 'review-token-123'
    const srv = spawn('python3', ['-I', '-B', 'server.py', '--main', r, '--bin', BIN, '--port', '0'],
      { cwd: join(ROOT_DIR, 'ui'), env: { ...process.env, RAMIFY_UI_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const url = await new Promise<string>((ok, fail) => {
        srv.stdout.on('data', (d: Buffer) => ok(String(d).trim()))
        srv.on('exit', (code) => fail(new Error(`server exited (${code})`)))
      })
      assert.match(url, new RegExp(`#token=${token}$`))
      assert.doesNotMatch(execFileSync('ps', ['-o', 'args=', '-p', String(srv.pid)], { encoding: 'utf8' }), new RegExp(token))
      const base = url.replace(/\/#token=.*$/, '')
      assert.equal((await fetch(`${base}/api/state`, { headers: { 'X-Token': 'wrong' } })).status, 401)
      assert.equal((await fetch(`${base}/api/state`, { headers: { 'X-Token': token } })).status, 200)
    } finally { srv.kill() }
  })

  it('reads git output that is not UTF-8 instead of failing the request', () => {
    const r = spawnSync('python3', ['-I', '-B', '-c', [
      'import sys', `sys.path.insert(0, ${JSON.stringify(join(ROOT_DIR, 'ui'))})`, 'import server',
      "server.run(['printf', 'caf\\\\351'])",
    ].join('\n')], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  })
})
