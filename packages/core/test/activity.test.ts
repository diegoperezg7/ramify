import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
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
    assert.deepEqual(claudeContext(42, home), { cwd: '/Users/d/code/shop', state: 'working' })
    assert.equal(claudeContext(7, home), null)
  })
})
