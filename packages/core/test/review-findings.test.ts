// Bugs confirmed in the review of 2026-11-05. Each test states the behaviour the code should have and fails today,
// so it is marked `todo`: the run reports it without failing. Drop the `todo` when its fix lands: the test then
// guards against the bug coming back.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SessionLog, sessionsCsv, claudeContext, type LiveSession, type Resolved } from '../src/activity.ts'
import { riskyGitConfig } from '../src/engine.ts'
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

  it('a session the user closed stays closed after "clear history"', { todo: 'SessionLog.clear (activity.ts:577) drops the record closedByUser needs' }, () => {
    const log = new SessionLog()
    log.update([live('pid:7', 1000)], 2000)
    assert.ok(log.close(log.sessions[0].id, 3000))
    log.clear()
    const r = log.update([live('pid:7', 1000)], 4000)
    assert.equal(r.started.length, 0)
  })

  it('the CSV export neutralises cells a spreadsheet would run as formulas', { todo: 'csvCell (activity.ts:600) quotes only " , and newlines' }, () => {
    const s: AgentSession = {
      id: '1', key: 'pid:1', agent: 'claude', host: 'Ghostty', via: 'terminal', inferred: false, cwd: '/r', repo: '/r',
      branch: '=HYPERLINK("https://example.invalid","x")', github: null, start: 0, end: 60_000, lastSeen: 60_000,
    }
    const row = sessionsCsv([s], 60_000).split('\n')[1]
    assert.doesNotMatch(row, /(^|,)"?=/)
  })

  it('a session id with path segments does not lead the scanner out of ~/.claude/projects', { todo: 'claudeContext (activity.ts:399) joins sessionId unchecked' }, () => {
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

describe('setup undo', () => {
  it('removing a block whose end line the user deleted keeps the rest of the file', { todo: 'withoutBlock (setup.ts:57) skips to the end of the file' }, () => {
    const text = ['export A=1', '# >>> ramify >>>', 'export PATH=x', 'alias ll="ls -l"', 'export B=2'].join('\n')
    const out = withoutBlock(text, '# >>> ramify >>>', '# <<< ramify <<<')
    assert.match(out, /export B=2/)
  })
})

describe('browser host server (ui/server.py)', () => {
  it('reads git output that is not UTF-8 instead of failing the request', { todo: 'run() in ui/server.py:25 decodes strict UTF-8' }, () => {
    const r = spawnSync('python3', ['-I', '-B', '-c', [
      'import sys', `sys.path.insert(0, ${JSON.stringify(join(ROOT_DIR, 'ui'))})`, 'import server',
      "server.run(['printf', 'caf\\\\351'])",
    ].join('\n')], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  })
})
