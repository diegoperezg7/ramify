import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, isSafeExternal, sanitizeSettings, strings } from '../src/host.ts'
import { idesFor, knownIde } from '../src/engine.ts'
import { SessionLog } from '../src/activity.ts'
import type { AgentSession, Settings } from '../src/types.ts'

describe('IPC', () => {
  const handlers = { ping: () => 'pong' }

  it('answers only the handler object own functions', async () => {
    assert.equal(await dispatch(handlers, 'ping', []), 'pong')
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'missing']) {
      await assert.rejects(dispatch(handlers, name, []), /not available/)
    }
  })

  it('rejects arguments that are not a short list', async () => {
    await assert.rejects(dispatch(handlers, 'ping', 'x' as unknown as unknown[]), /bad arguments/)
    await assert.rejects(dispatch(handlers, 'ping', Array(9).fill(0)), /bad arguments/)
  })

  it('accepts only plain strings where paths and names are expected', () => {
    assert.doesNotThrow(() => strings('/Users/me/code', 'feat/x'))
    assert.throws(() => strings({ toString: () => '/' }))
    assert.throws(() => strings('a\0b'))
    assert.throws(() => strings('x'.repeat(5000)))
  })
})

describe('external links', () => {
  it('opens https anywhere and http only on this machine', () => {
    assert.ok(isSafeExternal('https://github.com/me/repo/pull/1'))
    assert.ok(isSafeExternal('http://localhost:4100'))
    assert.ok(isSafeExternal('http://127.0.0.1:4105/x'))
    for (const bad of ['http://evil.example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'https://user:pw@github.com', 'not a url']) {
      assert.ok(!isSafeExternal(bad), bad)
    }
  })
})

describe('settings from the UI', () => {
  const current: Settings = { terminal: 'Terminal', defaultAgent: 'claude', projectsDir: '/Users/me/code', autoDetect: true, historyDays: 90 }

  it('keeps known keys with valid values and drops the rest', () => {
    const next = sanitizeSettings({ terminal: 'iTerm', autoDetect: false, historyDays: 30, evil: 'x', ignored: ['codex', 5] }, current)
    assert.equal(next.terminal, 'iTerm')
    assert.equal(next.autoDetect, false)
    assert.equal(next.historyDays, 30)
    assert.deepEqual(next.ignored, ['codex'])
    assert.ok(!('evil' in next))
  })

  it('ignores values of the wrong type or out of range', () => {
    const next = sanitizeSettings({ terminal: 'rm -rf /', defaultAgent: 'a b; c', autoDetect: 'yes', historyDays: 7, projectsDir: 42 }, current)
    assert.deepEqual(next, current)
    assert.deepEqual(sanitizeSettings(null, current), current)
  })
})

describe('session history', () => {
  const s = (id: string, end: number | null): AgentSession => ({ id, agent: 'claude', host: 'Terminal', via: 'terminal', inferred: false, cwd: null, repo: null, branch: null, github: null, start: 0, end, lastSeen: end ?? 0 })

  it('forgets finished sessions older than the retention, never the running ones', () => {
    const now = 100 * 86400_000
    const log = new SessionLog([s('old', now - 40 * 86400_000), s('recent', now - 5 * 86400_000)], now)
    log.prune(5000, 30, now)
    assert.deepEqual(log.sessions.map((x) => x.id), ['recent'])
    log.prune(5000, 0, now)
    assert.equal(log.sessions.length, 1)
  })

  it('clears the history but keeps what is running', () => {
    const log = new SessionLog()
    log.update([{ key: 'pid:1', agent: 'codex', host: 'iTerm', via: 'terminal', inferred: false, cwd: null, start: 0, repo: null, branch: null, github: null }], 1000)
    log.sessions.push(s('done', 500))
    log.clear()
    assert.deepEqual(log.sessions.map((x) => x.agent), ['codex'])
  })
})

describe('editors', () => {
  it('offers only installed editors, the preferred one first, then Finder', () => {
    assert.deepEqual(idesFor(['Xcode', 'VS Code', 'Cursor']), ['cursor', 'code', 'Xcode'.toLowerCase(), 'Finder'])
    assert.deepEqual(idesFor(['Xcode', 'VS Code', 'Android Studio'], 'Android Studio'), ['Android Studio', 'code', 'xcode', 'Finder'])
    assert.deepEqual(idesFor([]), ['Finder'])
  })

  it('accepts short ids and catalog editors, nothing else', () => {
    assert.ok(knownIde('cursor') && knownIde('Android Studio') && knownIde('Finder'))
    assert.ok(!knownIde('rm -rf') && !knownIde('Calculator'))
  })

  it('keeps a valid default editor from the UI', () => {
    const current: Settings = { terminal: 'Terminal', defaultAgent: 'claude', projectsDir: '/p', autoDetect: true }
    assert.equal(sanitizeSettings({ defaultIde: 'PyCharm' }, current).defaultIde, 'PyCharm')
    assert.equal(sanitizeSettings({ defaultIde: 'open -a Terminal' }, current).defaultIde, undefined)
  })
})
