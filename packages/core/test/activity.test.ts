import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aiAppMain, appOf, folderOf, hostOf, isActive, parseWinPs, winAppOf, ideSessions, parseEtime, parsePs, SessionLog, sessionsCsv, type LiveSession, type Resolved } from '../src/activity.ts'

const PS = `
    1     0  10-00:00:00 /sbin/launchd
  100     1  01:00:00 /Applications/Ghostty.app/Contents/MacOS/ghostty
  101   100  59:00 /usr/bin/login -flp diego /bin/zsh
  102   101  58:00 -zsh
  103   102  05:00 claude
  200     1  02:00:00 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  201   200  01:59:00 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin) --type=utility
  202   201  10:00 /Users/d/.vscode/extensions/anthropic.claude-code-2.0.0/resources/native-binary/claude --output-format stream-json
  300     1  03:00:00 /opt/homebrew/bin/tmux new-session -s work
  301   300  02:00:00 -zsh
  302   301  20:00 codex
  400   100  30:00 /usr/bin/login -flp diego /bin/zsh
  401   400  29:00 -zsh
  402   401  29:00 tmux attach -t work
`

describe('process tree', () => {
  const procs = parsePs(PS)
  // These process lists are macOS ones: name apps from their bundles on every OS.
  const mac = (p: { args: string }) => appOf(p.args)

  it('parses etime', () => {
    assert.equal(parseEtime('05:00'), 300)
    assert.equal(parseEtime('01:00:00'), 3600)
    assert.equal(parseEtime('2-01:00:00'), 2 * 86400 + 3600)
    assert.equal(procs.get(103)?.elapsed, 300)
  })

  it('names the app from its bundle path', () => {
    assert.equal(appOf('/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/x'), 'VS Code')
    assert.equal(appOf('/Applications/iTerm.app/Contents/MacOS/iTerm2'), 'iTerm')
    assert.equal(appOf('-zsh'), null)
  })

  it('finds the terminal an agent runs in', () => {
    assert.deepEqual(hostOf(103, procs, undefined, mac), { host: 'Ghostty', via: 'terminal' })
  })

  it('finds the IDE that started an agent extension', () => {
    assert.deepEqual(hostOf(202, procs, undefined, mac), { host: 'VS Code', via: 'ide' })
  })

  it('traces a tmux pane to the terminal attached to its session', () => {
    const tmux = { paneSession: new Map([[301, 'work']]), clients: new Map([['work', 402]]) }
    assert.deepEqual(hostOf(302, procs, tmux, mac), { host: 'Ghostty · tmux', via: 'terminal' })
    assert.deepEqual(hostOf(302, procs, undefined, mac), { host: 'tmux', via: 'terminal' })
  })
})

describe('IDE chat', () => {
  it('reads the folder of a workspace', () => {
    assert.equal(folderOf('{"folder":"file:///Users/d/My%20App"}'), '/Users/d/My App')
    assert.equal(folderOf('{"folder":"vscode-remote://x/workspace"}'), null)
  })

  it('reports workspaces with recent activity of a running IDE only', () => {
    const support = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-ide-')))
    const project = join(support, 'proj')
    mkdirSync(project)
    const now = Date.now()
    const ws = (app: string, id: string, chat: boolean, ageMs: number) => {
      const d = join(support, app, 'User', 'workspaceStorage', id)
      mkdirSync(chat ? join(d, 'chatSessions') : d, { recursive: true })
      writeFileSync(join(d, 'workspace.json'), JSON.stringify({ folder: `file://${project}` }))
      const f = chat ? join(d, 'chatSessions', 's.json') : join(d, 'state.vscdb')
      writeFileSync(f, '')
      const t = (now - ageMs) / 1000
      utimesSync(f, t, t)
      if (chat) utimesSync(join(d, 'chatSessions'), t, t)
    }
    ws('Cursor', 'a', false, 60_000)
    ws('Cursor', 'old', false, 3600_000)
    ws('Code', 'b', true, 30_000)
    const cursorOnly = parsePs('  10 1 01:00 /Applications/Cursor.app/Contents/MacOS/Cursor')
    const found = ideSessions(cursorOnly, now, support, false)
    assert.equal(found.length, 1)
    assert.equal(found[0].host, 'Cursor')
    assert.equal(found[0].cwd, project)
    assert.equal(found[0].inferred, true)
    const both = parsePs('  10 1 01:00 /Applications/Cursor.app/Contents/MacOS/Cursor\n  11 1 01:00 /Applications/Visual Studio Code.app/Contents/MacOS/Electron')
    assert.deepEqual(ideSessions(both, now, support, false).map((s) => s.agent).sort(), ['copilot', 'cursor'])
  })
})

describe('session history', () => {
  const none: Resolved = { repo: null, branch: null, github: null }
  const cli = (key: string, start: number): LiveSession & Resolved => ({ key, agent: 'claude', host: 'Ghostty', via: 'terminal', inferred: false, cwd: '/r', start, ...none, repo: '/r', branch: 'feat/x', github: 'o/r' })

  it('opens, keeps and closes sessions', () => {
    const log = new SessionLog()
    let r = log.update([cli('pid:1:0', 1000)], 2000)
    assert.equal(r.started.length, 1)
    r = log.update([cli('pid:1:0', 1000)], 3000)
    assert.equal(r.started.length + r.ended.length, 0)
    assert.equal(log.sessions[0].lastSeen, 3000)
    r = log.update([], 4000)
    assert.equal(r.ended.length, 1)
    assert.equal(log.sessions[0].end, 4000)
  })

  it('closes sessions left open by a previous run at their last sighting', () => {
    const log = new SessionLog([{ ...cli('k', 1000), id: 'x', end: null, lastSeen: 5000 }], 9000)
    assert.equal(log.sessions[0].end, 5000)
  })

  it('exports CSV with quoting', () => {
    const csv = sessionsCsv([{ id: 'x', agent: 'claude', host: 'Ghostty · tmux', via: 'terminal', inferred: false, cwd: '/a,b', repo: '/a,b', branch: 'm', github: null, start: 0, end: 120_000, lastSeen: 0 }])
    const [head, row] = csv.trim().split('\n')
    assert.match(head, /^agent,host,via/)
    assert.match(row, /"\/a,b"/)
    assert.match(row, /,2$/)
  })
})

describe('active sessions and closing them', () => {
  const live = (key: string, start: number, state?: 'working' | 'idle'): LiveSession & Resolved =>
    ({ key, agent: 'claude', host: 'Ghostty', via: 'terminal', inferred: false, cwd: '/r', start, state, repo: '/r', branch: 'main', github: null })

  it('counts one of two open sessions when the other is idle', () => {
    const log = new SessionLog()
    log.update([live('pid:1', 1000, 'working'), live('pid:2', 1000, 'idle')], 2000)
    assert.equal(log.sessions.filter((s) => s.end === null).length, 2)
    assert.equal(log.sessions.filter(isActive).length, 1)
  })

  it('keeps a session the user closed closed while its process lives, also after a restart', () => {
    const log = new SessionLog()
    log.update([live('pid:1', 1000, 'working'), live('pid:2', 1000, 'idle')], 2000)
    const idle = log.sessions.find((s) => s.key === 'pid:2')!
    assert.ok(log.close(idle.id, 3000))
    assert.equal(log.close(idle.id, 3000), null)
    let r = log.update([live('pid:1', 1000, 'working'), live('pid:2', 1001, 'idle')], 4000)
    assert.equal(r.started.length, 0)
    assert.deepEqual(log.sessions.filter((s) => s.end === null).map((s) => s.key), ['pid:1'])
    assert.equal(log.sessions.find((s) => s.key === 'pid:2')!.end, 3000)

    const reopened = new SessionLog(JSON.parse(JSON.stringify(log.sessions)), 9000)
    r = reopened.update([live('pid:1', 1000, 'working'), live('pid:2', 1000, 'idle')], 10_000)
    assert.equal(r.started.length, 0)
    assert.deepEqual(reopened.sessions.filter((s) => s.end === null).map((s) => s.key), ['pid:1'])
    // The same pid reused by a new process is a new conversation.
    r = reopened.update([live('pid:2', 60_000, 'working')], 61_000)
    assert.equal(r.started.length, 1)
  })

  it('reopens a closed IDE chat only with newer activity', () => {
    const ide = (start: number): LiveSession & Resolved => ({ ...live('ide:Cursor:/r', start), via: 'ide', inferred: true })
    const log = new SessionLog()
    log.update([ide(1000)], 2000)
    log.close(log.sessions[0].id, 3000)
    assert.equal(log.update([ide(1000)], 4000).started.length, 0)
    assert.equal(log.update([ide(5000)], 6000).started.length, 1)
  })
})

describe('restarts', () => {
  it('resumes a session still running after the app restarts instead of duplicating it', () => {
    const live: LiveSession & Resolved = { key: 'pid:7', agent: 'codex', host: 'iTerm', via: 'terminal', inferred: false, cwd: null, start: 1000, repo: null, branch: null, github: null }
    const first = new SessionLog()
    first.update([live], 2000)
    const saved = JSON.parse(JSON.stringify(first.sessions))
    const second = new SessionLog(saved, 9000)
    const r = second.update([{ ...live, start: 1999 }], 10_000)
    assert.equal(r.started.length, 0)
    assert.equal(second.sessions.length, 1)
    assert.equal(second.sessions[0].end, null)
    const third = new SessionLog(JSON.parse(JSON.stringify(second.sessions)), 20_000)
    assert.equal(third.update([], 21_000).ended.length, 0)
    assert.equal(third.sessions[0].end, 10_000)
  })

  it('treats a reused pid as a new session', () => {
    const log = new SessionLog()
    const live: LiveSession & Resolved = { key: 'pid:9', agent: 'claude', host: 'Terminal', via: 'terminal', inferred: false, cwd: null, start: 1000, repo: null, branch: null, github: null }
    log.update([live], 2000)
    const r = log.update([{ ...live, start: 60_000 }], 61_000)
    assert.equal(r.started.length, 1)
    assert.equal(r.ended.length, 1)
    assert.equal(log.sessions.length, 2)
  })
})

describe('Windows', () => {
  const WIN_OUT = [
    '4\t0\t9000\t\t',
    '500\t4\t3600\tC:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe\t"C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe"',
    '501\t500\t3500\tC:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\tpowershell.exe -NoExit',
    '502\t501\t120\tC:\\Program Files\\nodejs\\node.exe\t"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\d\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
    '600\t4\t800\tC:\\Users\\d\\AppData\\Local\\Programs\\ChatGPT\\ChatGPT.exe\t"C:\\Users\\d\\AppData\\Local\\Programs\\ChatGPT\\ChatGPT.exe"',
    '601\t600\t790\tC:\\Users\\d\\AppData\\Local\\Programs\\ChatGPT\\ChatGPT.exe\t"C:\\Users\\d\\AppData\\Local\\Programs\\ChatGPT\\ChatGPT.exe" --type=renderer',
  ].join('\r\n')
  const procs = parseWinPs(WIN_OUT)

  it('parses the PowerShell process list', () => {
    const node = procs.get(502)!
    assert.equal(node.exe, 'C:/Program Files/nodejs/node.exe')
    assert.match(node.args, /@anthropic-ai\/claude-code\/cli\.js$/)
    assert.equal(node.elapsed, 120)
  })

  it('finds Windows Terminal as the host', () => {
    assert.equal(winAppOf('C:/x/WindowsTerminal.exe'), 'Windows Terminal')
    assert.equal(winAppOf('C:/Users/d/AppData/Local/AnthropicClaude/app-1.0/claude.exe'), 'Claude')
    assert.deepEqual(hostOf(502, procs, undefined, (p) => winAppOf(p.exe)), { host: 'Windows Terminal', via: 'terminal' })
  })

  it('counts only the main process of a desktop AI app', () => {
    assert.equal(aiAppMain(procs.get(600)!, procs, true), 'ChatGPT')
    assert.equal(aiAppMain(procs.get(601)!, procs, true), null)
  })

  it('reads Windows workspace folders', () => {
    assert.equal(folderOf('{"folder":"file:///c%3A/Users/d/proj"}'), 'c:/Users/d/proj')
  })
})

describe('catalog', () => {
  it('recognises agents by executable, by package and only trusts generic names by path', async () => {
    const { agentOf } = await import('../src/projects.ts')
    assert.equal(agentOf('/opt/homebrew/bin/codex', 'codex'), 'codex')
    assert.equal(agentOf('node', 'node /usr/local/lib/node_modules/@vegamo/deepcode-cli/dist/cli.js'), 'deepcode')
    assert.equal(agentOf('C:\\Users\\d\\AppData\\Roaming\\npm\\qwen.cmd', 'qwen'), 'qwen')
    assert.equal(agentOf('/Users/d/.local/bin/agent', 'agent'), null)
    assert.equal(agentOf('/Users/d/.local/share/cursor-agent/versions/1/agent', 'agent'), 'cursor')
    assert.equal(agentOf('/usr/bin/python3', 'python3 /Users/d/.local/bin/vibe'), 'vibe')
  })

  it('finds installed agents by executable or by the folder they create', async () => {
    const { installedTools } = await import('../src/tools.ts')
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-home-')))
    mkdirSync(join(home, 'bin'))
    writeFileSync(join(home, 'bin', 'gemini'), '')
    mkdirSync(join(home, '.codex'))
    writeFileSync(join(home, 'bin', 'agent'), '')
    const found = installedTools({ PATH: join(home, 'bin') }, home).agents
    assert.ok(found.includes('gemini') && found.includes('codex'))
    assert.ok(!found.includes('cursor'))
  })
})

describe('where an agent really works', () => {
  it('follows a Claude Code session from its pid to the project in its transcript', async () => {
    const { claudeContext } = await import('../src/activity.ts')
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-claude-')))
    mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(home, '.claude', 'projects', '-Users-d'), { recursive: true })
    writeFileSync(join(home, '.claude', 'sessions', '42.json'), JSON.stringify({ pid: 42, sessionId: 's1', cwd: '/Users/d', status: 'busy' }))
    writeFileSync(join(home, '.claude', 'projects', '-Users-d', 's1.jsonl'), [
      JSON.stringify({ cwd: '/Users/d', type: 'user' }),
      JSON.stringify({ cwd: '/Users/d/code/shop', type: 'assistant' }),
      // Text that merely mentions a cwd must not count.
      JSON.stringify({ type: 'user', message: { content: '"cwd":"/elsewhere"' } }),
    ].join('\n') + '\n')
    assert.deepEqual(claudeContext(42, home), {
      cwd: '/Users/d/code/shop', before: ['/Users/d'], wrote: null, state: 'working', sessionId: 's1', transcript: join(home, '.claude', 'projects', '-Users-d', 's1.jsonl'),
    })
    assert.equal(claudeContext(7, home), null)
  })

  it('remembers where a Claude Code session last edited and where it was before a cd', async () => {
    const { claudeContext } = await import('../src/activity.ts')
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-claude-')))
    mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(home, '.claude', 'projects', '-Users-d'), { recursive: true })
    writeFileSync(join(home, '.claude', 'sessions', '43.json'), JSON.stringify({ pid: 43, sessionId: 's2', cwd: '/Users/d', status: 'busy' }))
    const edit = (name: string, input: object, cwd: string) => JSON.stringify({ type: 'assistant', cwd, message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name, input }] } })
    const say = (cwd: string) => JSON.stringify({ type: 'user', cwd, message: { content: 'go on' } })
    const file = join(home, '.claude', 'projects', '-Users-d', 's2.jsonl')
    writeFileSync(file, [
      edit('Edit', { file_path: '/Users/d/code/keys/app.ts' }, '/Users/d/code/keys'),
      edit('Write', { file_path: '/Users/d/wt/shop/fix-cart/src/cart.ts' }, '/Users/d/wt/shop/fix-cart'),
      say('/Users/d/wt/shop/fix-cart'),
      // Reading is not editing: neither a Read nor a quoted tool call moves where it wrote.
      edit('Read', { file_path: '/Users/d/code/shop/README.md' }, '/Users/d/code/shop'),
      JSON.stringify({ type: 'user', cwd: '/Users/d/code/shop', message: { content: '{"type":"tool_use","name":"Edit","input":{"file_path":"/elsewhere/x.ts"}}' } }),
    ].join('\n') + '\n')
    const ctx = claudeContext(43, home)
    assert.equal(ctx?.cwd, '/Users/d/code/shop')
    assert.deepEqual(ctx?.before, ['/Users/d/wt/shop/fix-cart', '/Users/d/code/keys'])
    assert.equal(ctx?.wrote, '/Users/d/wt/shop/fix-cart/src')

    // Later turns are read from where the last read ended; a line still being written waits for the next one.
    appendFileSync(file, edit('Edit', { file_path: '/Users/d/code/shop/main.ts' }, '/Users/d/code/blog') + '\n' + '{"type":"assistant","cwd":"/Users/d/ha')
    const next = claudeContext(43, home)
    assert.equal(next?.cwd, '/Users/d/code/blog')
    assert.deepEqual(next?.before, ['/Users/d/code/shop', '/Users/d/wt/shop/fix-cart', '/Users/d/code/keys'])
    assert.equal(next?.wrote, '/Users/d/code/shop')
  })

  it('finds an edit megabytes back in a long transcript', async () => {
    const { lastPlace } = await import('../src/activity.ts')
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-long-')))
    const file = join(dir, 'long.jsonl')
    const filler = JSON.stringify({ type: 'progress', blob: 'x'.repeat(200_000) })
    writeFileSync(file, [
      JSON.stringify({ type: 'assistant', cwd: '/w/a', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/w/a/src/x.ts' } }] } }),
      ...Array.from({ length: 15 }, () => filler),
      JSON.stringify({ type: 'user', cwd: '/w/main', message: { content: 'hi' } }),
    ].join('\n') + '\n')
    const place = lastPlace(file)
    assert.equal(place.cwd, '/w/main')
    assert.equal(place.wrote, '/w/a/src')
    assert.deepEqual(place.before, ['/w/a'])
  })

  it('keeps a session on its worktree when it cds back to the main checkout', async () => {
    const { workPlace } = await import('../src/activity.ts')
    type At = { repo: string | null; worktree: string | null; branch: string | null }
    const main: At = { repo: '/r/shop', worktree: '/r/shop', branch: 'main' }
    const wt: At = { repo: '/r/shop', worktree: '/wt/shop/fix-cart', branch: 'fix/cart' }
    const keys: At = { repo: '/r/keys', worktree: '/wt/keys/feat-share', branch: 'feat/share' }
    const other: At = { repo: '/r/blog', worktree: '/r/blog', branch: 'main' }
    const none: At = { repo: null, worktree: null, branch: null }
    // Worked in a worktree (edits by shell, so no edit tool says so), then looked around the main checkout.
    assert.equal(workPlace(main, keys, [wt, keys]), wt)
    // Edited in the worktree with the edit tools: the same.
    assert.equal(workPlace(main, wt), wt)
    // Editing the main checkout itself is working on main: the warning must still show.
    assert.equal(workPlace(main, main, [wt]), main)
    // Only ever in the main checkout, or came from another repository: main.
    assert.equal(workPlace(main, null), main)
    assert.equal(workPlace(main, none, [other]), main)
    // Started in ~ and editing a repository by its full path: that repository.
    assert.equal(workPlace(none, wt), wt)
    assert.equal(workPlace(none, null), none)
    // Moving on to another worktree or repository moves the session with it.
    assert.equal(workPlace(wt, main, [main]), wt)
    assert.equal(workPlace(other, wt, [wt]), other)
  })
})

describe('throwaway folders', () => {
  it('tells folders in the temp directory from real projects', async () => {
    const { inTempDir } = await import('../src/activity.ts')
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-tmp-')))
    assert.equal(inTempDir(join(tmp, 'demo'), tmp), true)
    assert.equal(inTempDir(tmp, tmp), true)
    assert.equal(inTempDir('/tmp/x/demo', tmp), true)
    // A sibling whose name only starts like the temp directory is not inside it (a made-up root: on Linux the
    // real one is /tmp, where any sibling is in /tmp too).
    assert.equal(inTempDir('/opt/scratch/demo', '/opt/scratch'), true)
    assert.equal(inTempDir('/opt/scratch-other/demo', '/opt/scratch'), false)
    assert.equal(inTempDir('/Users/d/code/shop', tmp), false)
    assert.equal(inTempDir(null, tmp), false)
    if (process.platform === 'darwin') {
      // $TMPDIR is /var/folders/…, which resolves to /private/var/folders/…: both spellings count.
      const sys = tmpdir()
      assert.equal(inTempDir(join(realpathSync(sys), 'tmp.X', 'demo')), true)
      assert.equal(inTempDir(join(realpathSync(sys).replace(/^\/private/, ''), 'tmp.X', 'demo')), true)
    }
  })
})

describe('agents started by an agent', () => {
  it('recognises a Claude Code teammate in a pane of its own', async () => {
    const { teammateOf } = await import('../src/activity.ts')
    const exe = '/Users/d/.local/share/claude/versions/2.1.318'
    const args = '--agent-id rev@session-ab --agent-name rev --team-name session-ab --agent-color blue --parent-session-id 1234-abcd --agent-type code-reviewer --model opus'
    assert.deepEqual(teammateOf(exe, args), { name: 'rev', parentSessionId: '1234-abcd', agentType: 'code-reviewer' })
    assert.deepEqual(teammateOf(exe, '--agent-name rev --parent-session-id 1234-abcd'), { name: 'rev', parentSessionId: '1234-abcd', agentType: null })
    // The lead itself (no parent) and other binaries are not teammates.
    assert.equal(teammateOf(exe, '--model opus'), null)
    assert.equal(teammateOf('/usr/local/bin/claude', args), null)
  })

  it('lists the subagents of a session that are in the middle of a turn', async () => {
    const { claudeSubagents } = await import('../src/activity.ts')
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-sub-')))
    const transcript = join(dir, 's1.jsonl')
    writeFileSync(transcript, '')
    const subs = join(dir, 's1', 'subagents')
    mkdirSync(subs, { recursive: true })
    const agent = (id: string, meta: object, cwd?: string) => {
      writeFileSync(join(subs, `agent-${id}.meta.json`), JSON.stringify(meta))
      writeFileSync(join(subs, `agent-${id}.jsonl`), cwd ? JSON.stringify({ cwd, type: 'assistant' }) + '\n' : '')
    }
    agent('a1', { agentType: 'Explore', description: 'Find the parser' }, '/Users/d/code/shop/.worktrees/agent-a1')
    agent('a2', { agentType: 'Plan', description: 'Done already', finished: true })
    agent('a3', { agentType: 'Explore', description: 'From an earlier run' })
    const old = new Date(Date.now() - 3_600_000)
    utimesSync(join(subs, 'agent-a3.meta.json'), old, old)

    const since = Date.now() - 60_000
    assert.deepEqual(claudeSubagents(transcript, since), [
      { id: 'a1', agentType: 'Explore', description: 'Find the parser', cwd: '/Users/d/code/shop/.worktrees/agent-a1' },
    ])
    // A subagent that finishes its turn drops out (the cache follows the file's modification time).
    writeFileSync(join(subs, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', finished: true }))
    const later = new Date(Date.now() + 2000)
    utimesSync(join(subs, 'agent-a1.meta.json'), later, later)
    assert.deepEqual(claudeSubagents(transcript, since), [])
    assert.deepEqual(claudeSubagents(join(dir, 'none.jsonl')), [])
  })

  it('reads recent Codex threads and the thread that spawned each one', async (t) => {
    const { codexThreads } = await import('../src/activity.ts')
    const mod = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('node:sqlite') as
      { DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void } } | undefined
    if (!mod) { t.skip('no node:sqlite in this Node'); return }
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-codex-')))
    mkdirSync(join(home, '.codex'))
    const file = join(home, '.codex', 'state_5.sqlite')
    const now = Date.now()
    const db = new mod.DatabaseSync(file)
    db.exec(`
      create table threads (id text primary key, cwd text, git_branch text, agent_role text, agent_nickname text,
        updated_at integer, updated_at_ms integer, archived integer);
      create table thread_spawn_edges (parent_thread_id text, child_thread_id text, status text);
      insert into threads values ('t1', '/Users/d/code/shop', 'main', null, null, ${Math.floor(now / 1000)}, ${now}, 0);
      insert into threads values ('t2', '/Users/d/code/shop', 'feat/x', 'worker', 'Ada', ${Math.floor(now / 1000)}, ${now - 1000}, 0);
      insert into threads values ('t3', '/Users/d/code/old', 'main', null, null, 1, 1000, 0);
      insert into threads values ('t4', '/Users/d/code/shop', 'main', null, null, ${Math.floor(now / 1000)}, ${now}, 1);
      insert into thread_spawn_edges values ('t1', 't2', 'open');`)
    db.close()
    assert.deepEqual(codexThreads(now - 60_000, home), [
      { id: 't1', cwd: '/Users/d/code/shop', branch: 'main', name: null, parentId: null, updatedAt: now },
      { id: 't2', cwd: '/Users/d/code/shop', branch: 'feat/x', name: 'Ada', parentId: 't1', updatedAt: now - 1000 },
    ])
    // No database, or one of another schema: nothing, not an error.
    assert.deepEqual(codexThreads(0, join(home, 'none')), [])
    writeFileSync(join(home, 'bad.sqlite'), 'not a database')
    assert.deepEqual(codexThreads(0, home, join(home, 'bad.sqlite')), [])
  })
})

describe('what a Claude Code session is doing', () => {
  it('reads the task, the last step, the files edited and the last hour from its transcript, then only new lines', async () => {
    const { transcriptGlance } = await import('../src/activity.ts')
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-glance-')))
    const file = join(dir, 's.jsonl')
    const now = Date.parse('2026-11-05T18:00:00Z')
    const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString()
    const user = (content: unknown, extra = {}) => JSON.stringify({ type: 'user', message: { content }, ...extra })
    const tool = (minAgo: number, name: string, input: object) => JSON.stringify({ type: 'assistant', timestamp: at(minAgo), message: { content: [{ type: 'tool_use', name, input }] } })
    writeFileSync(file, [
      user('<command-name>/clear</command-name>'),
      user('Caveat: the messages below were generated by the user while running local commands.'),
      user('ignored', { isMeta: true }),
      user([{ type: 'text', text: 'Redesign   the sessions view\nwith cards' }]),
      tool(90, 'Edit', { file_path: '/r/a.ts' }),
      user([{ type: 'tool_result', content: 'ok' }]),
      tool(50, 'Write', { file_path: '/r/b.ts' }),
      tool(50, 'Edit', { file_path: '/r/a.ts' }),
      tool(2, 'Bash', { command: 'npm test\nmore' }),
    ].join('\n') + '\n')
    const first = transcriptGlance(file, now)
    assert.equal(first.task, 'Redesign the sessions view with cards')
    assert.deepEqual(first.glance.action, { tool: 'Bash', target: 'npm test', at: now - 2 * 60_000 })
    assert.equal(first.glance.files, 2)
    // An hour in twelve five-minute slots: two replies 50 minutes ago, one 2 minutes ago; the one 90 minutes ago is out.
    assert.deepEqual(first.glance.pulse, [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1])

    appendFileSync(file, tool(1, 'Read', { file_path: '/r/c.ts' }) + '\n' + tool(0, 'Edit', { file_path: '/r/c.ts' }) + '\n')
    const next = transcriptGlance(file, now)
    assert.deepEqual(next.glance.action, { tool: 'Edit', target: 'c.ts', at: now })
    assert.equal(next.glance.files, 3)
    assert.equal(next.glance.pulse[11], 3)
  })
})
