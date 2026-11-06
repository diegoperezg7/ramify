import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { actionWords, agoWords, attentionCount, branchKey, mergeReady, sessionAttention, staleReady, staleWait } from '../src/attention.ts'
import type { AgentSession, BranchHealth, PullRequest } from '../src/types.ts'

const branch = (over: Partial<BranchHealth> = {}): BranchHealth => ({
  path: '/r/wt', branch: 'feat/x', main: false, agent: 'claude', running: [], ahead: 2, behind: 0, uncommitted: 0,
  added: 10, deleted: 2, files: 2, unpushed: 0, lastCommit: 1, merged: false, overlaps: [], ...over,
})
const pr = (over: Partial<PullRequest> = {}): PullRequest => ({ number: 1, url: 'u', state: 'OPEN', draft: false, title: 't', branch: 'feat/x', ...over })

describe('a branch ready to merge', () => {
  it('has commits of its own, nothing pending, nothing to bring in and nobody working in it', () => {
    assert.equal(mergeReady(branch(), false), true)
    assert.equal(mergeReady(branch(), false, pr()), true)
  })
  it('is not ready while anything is left to do', () => {
    assert.equal(mergeReady(branch({ ahead: 0 }), false), false, 'no commits')
    assert.equal(mergeReady(branch({ uncommitted: 3 }), false), false, 'uncommitted work')
    assert.equal(mergeReady(branch({ behind: 1 }), false), false, 'base moved on')
    assert.equal(mergeReady(branch({ overlaps: ['feat/y'] }), false), false, 'touches what another branch touches')
    assert.equal(mergeReady(branch({ running: ['claude'] }), false), false, 'an agent works in it')
    assert.equal(mergeReady(branch(), true), false, 'busy (a subagent or an open session)')
    assert.equal(mergeReady(branch({ merged: true }), false), false, 'already in the base')
    assert.equal(mergeReady(branch({ main: true }), false), false, 'the main checkout')
    assert.equal(mergeReady(branch(), false, pr({ draft: true })), false, 'draft pull request')
    assert.equal(mergeReady(branch(), false, pr({ state: 'MERGED' })), false, 'merged pull request')
  })
})

describe('a branch whose agent has to run ramify ready again', () => {
  it('was marked ready, and the base moved past it', () => {
    assert.equal(staleReady(branch({ ready: 'stale', behind: 1 })), true)
  })
  it('not for its own new commits, a mark still valid, no mark, a merged branch or the main checkout', () => {
    assert.equal(staleReady(branch({ ready: 'stale', behind: 0 })), false, 'stale by its own commits: its agent knows')
    assert.equal(staleReady(branch({ ready: 'ready', behind: 0 })), false, 'still ready')
    assert.equal(staleReady(branch({ ready: null, behind: 3 })), false, 'never marked')
    assert.equal(staleReady(branch({ behind: 3 })), false, 'no mark at all (an older ramify)')
    assert.equal(staleReady(branch({ ready: 'stale', behind: 2, merged: true })), false, 'already in the base')
    assert.equal(staleReady(branch({ ready: 'stale', behind: 2, main: true })), false, 'the main checkout')
    assert.equal(staleReady(branch({ ready: 'waiting', behind: 2 })), false, 'a waiting branch is told apart')
  })
  it('waited for its turn, and the base moved since: what it waited for may be merged', () => {
    assert.equal(staleWait(branch({ ready: 'waiting', behind: 2 })), true)
    assert.equal(staleWait(branch({ ready: 'waiting', behind: 0 })), false, 'the base has not moved: still waiting')
    assert.equal(staleWait(branch({ ready: 'waiting', behind: 2, merged: true })), false, 'already in the base')
    assert.equal(staleWait(branch({ ready: 'waiting', behind: 2, main: true })), false, 'the main checkout')
    assert.equal(staleWait(branch({ ready: 'stale', behind: 2 })), false, 'a stale mark is told apart')
    assert.equal(staleWait(branch({ ready: 'ready', behind: 0 })), false, 'ready')
  })
})

describe('a session that needs the user', () => {
  let n = 0
  const s = (over: Partial<AgentSession> = {}): AgentSession => ({
    id: `s${++n}`, agent: 'claude', host: 'tmux', via: 'terminal', inferred: false, cwd: '/r', repo: '/r', branch: 'feat/x',
    github: null, start: 0, end: null, lastSeen: 0, state: 'working', ...over,
  })
  // As the scan sees Codex, Gemini and the rest: without a state, which only some agents report.
  const quiet = (over: Partial<AgentSession> = {}) => s({ agent: 'codex', state: undefined, ...over })

  it('waits for an answer', () => {
    const a = s({ state: 'waiting' })
    assert.deepEqual(sessionAttention(a, [a], new Set()), ['waiting'])
  })
  it('works on the same branch as another agent at work, but not beside a paused one', () => {
    const a = s(), b = quiet(), idle = s({ state: 'idle' })
    assert.deepEqual(sessionAttention(a, [a, b], new Set()), ['shared'])
    assert.deepEqual(sessionAttention(b, [a, b], new Set()), ['shared'])
    assert.deepEqual(sessionAttention(a, [a, idle], new Set()), [])
    assert.deepEqual(sessionAttention(idle, [a, idle], new Set()), [])
  })
  it('takes an agent that does not report its state as maybe at work, never as waiting', () => {
    const onMain = quiet({ branch: 'main' })
    assert.deepEqual(sessionAttention(onMain, [onMain], new Set()), ['main'])
    const codex = quiet(), gemini = quiet({ agent: 'gemini' })
    assert.deepEqual(sessionAttention(codex, [codex, gemini], new Set()), ['shared'])
    assert.deepEqual(sessionAttention(gemini, [codex, gemini], new Set()), ['shared'])
    const idle = s({ state: 'idle' })
    assert.deepEqual(sessionAttention(codex, [codex, idle], new Set()), [], 'beside a paused one')
    assert.deepEqual(sessionAttention(idle, [codex, idle], new Set()), [])
    assert.equal(attentionCount([onMain], new Set()), 1)
    assert.equal(attentionCount([codex, gemini], new Set()), 2)
    assert.equal(attentionCount([codex, idle], new Set()), 0)
  })
  it('does not take an agent that does not report its state as stopped on a ready branch', () => {
    const ready = new Set([branchKey('/r', 'feat/x')])
    const codex = quiet()
    assert.deepEqual(sessionAttention(codex, [codex], ready), [])
    assert.equal(attentionCount([codex], ready), 1, 'the ready branch still counts, once')
  })
  it('works straight on the shared branch', () => {
    const a = s({ branch: 'main' })
    assert.deepEqual(sessionAttention(a, [a], new Set()), ['main'])
    assert.deepEqual(sessionAttention(s({ branch: 'main', state: 'idle' }), [], new Set()), [])
  })
  it('stopped on a branch ready to merge; most urgent reason first', () => {
    const ready = new Set([branchKey('/r', 'feat/x')])
    assert.deepEqual(sessionAttention(s({ state: 'idle' }), [], ready), ['ready'])
    assert.deepEqual(sessionAttention(s({ state: 'waiting' }), [], ready), ['waiting', 'ready'])
    assert.deepEqual(sessionAttention(s(), [], ready), [], 'still working: not ready to hand over')
  })
  it('never for finished, inferred or app sessions', () => {
    const ready = new Set([branchKey('/r', 'feat/x')])
    for (const x of [s({ end: 5, state: 'waiting' }), s({ inferred: true, state: 'waiting' }), s({ via: 'app', state: 'waiting' })]) assert.deepEqual(sessionAttention(x, [x], ready), [])
  })
  it('counts sessions with a reason and ready branches no session stands for, each once', () => {
    const waiting = s({ state: 'waiting', branch: 'feat/a' })
    const done = s({ state: 'idle', branch: 'feat/b' })
    const working = s({ branch: 'feat/c' })
    const ready = new Set([branchKey('/r', 'feat/b'), branchKey('/r', 'feat/d')])
    assert.equal(attentionCount([waiting, done, working], ready), 3)
    assert.equal(attentionCount([working], new Set()), 0)
  })
})

describe('a session in words, for the menu bar', () => {
  it('names its last step and how long ago', () => {
    assert.equal(actionWords({ tool: 'Edit', target: 'MEMORY.md', at: 0 }, true), 'Editando MEMORY.md')
    assert.equal(actionWords({ tool: 'Bash', target: 'npm test', at: 0 }, false), 'Running npm test')
    assert.equal(actionWords({ tool: 'mcp__github__create_issue', target: null, at: 0 }, true), 'Usando create_issue')
    assert.equal(agoWords(45 * 60_000, true), 'hace 45 min')
    assert.equal(agoWords(20_000, false), 'now')
    assert.equal(agoWords(3 * 3_600_000, false), '3 h ago')
  })
})
