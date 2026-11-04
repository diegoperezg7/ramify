import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { agentTimeByDay, lastActivity, lastDays, levels, nextAction, parseDiff, taskSlug, timeBy, unionMs } from '../../../ui/web/src/logic.ts'
import type { BranchHealth, PullRequest } from '../src/types.ts'

const branch = (o: Partial<BranchHealth>): BranchHealth => ({
  path: '/w/x', branch: 'feat/x', main: false, agent: 'claude', running: [], ahead: 0, behind: 0, uncommitted: 0,
  added: 0, deleted: 0, files: 0, unpushed: null, lastCommit: null, merged: false, overlaps: [], ...o,
})
const pr = (o: Partial<PullRequest>): PullRequest => ({ number: 1, url: 'https://github.com/a/b/pull/1', state: 'OPEN', draft: true, title: 't', branch: 'feat/x', ...o })

describe('control center: next action', () => {
  it('moves an agent off the shared branch first', () => {
    assert.equal(nextAction(branch({ main: true, running: ['claude'] }), undefined, true), 'move')
  })
  it('removes what is already merged', () => {
    assert.equal(nextAction(branch({ merged: true }), undefined, true), 'remove')
    assert.equal(nextAction(branch({ ahead: 2 }), pr({ state: 'MERGED' }), true), 'remove')
  })
  it('brings in the base before anything else, but never over uncommitted work', () => {
    assert.equal(nextAction(branch({ behind: 3, ahead: 2 }), undefined, true), 'update')
    assert.equal(nextAction(branch({ behind: 3, ahead: 2, uncommitted: 1 }), undefined, true), 'pr')
  })
  it('opens a pull request only on GitHub and only once', () => {
    assert.equal(nextAction(branch({ ahead: 2 }), undefined, true), 'pr')
    assert.equal(nextAction(branch({ ahead: 2 }), undefined, false), 'open')
    assert.equal(nextAction(branch({ ahead: 2 }), pr({}), true), 'view-pr')
  })
})

describe('new agent: branch from the task', () => {
  it('makes a short, safe slug', () => {
    assert.equal(taskSlug('Añadir login con magic links'), 'anadir-login-con-magic-links')
    assert.equal(taskSlug('  Fix: the cart total (rounding)!! now please today '), 'fix-the-cart-total-rounding-now')
    assert.equal(taskSlug(''), '')
    assert.ok(taskSlug('x'.repeat(80)).length <= 40)
  })
})

describe('contribution grid', () => {
  it('uses five steps: none, then quartiles of busy days', () => {
    const level = levels([0, 1, 2, 3, 4, 5, 6, 7, 8, 20])
    assert.equal(level(0), 0)
    assert.equal(level(1), 1)
    assert.equal(level(20), 4)
    assert.ok(level(5) >= 2 && level(5) <= 3)
    assert.equal(levels([])(3), 4)
  })
})

describe('diff view: parsing what git prints', () => {
  it('numbers added, removed and context lines from the hunk header', () => {
    const rows = parseDiff('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -10,3 +10,3 @@ fn\n keep\n-old\n+new\n')
    assert.deepEqual(rows.map((r) => [r.kind, r.old, r.new, r.text]), [
      ['hunk', null, null, '@@ -10,3 +10,3 @@ fn'], ['ctx', 10, 10, 'keep'], ['del', 11, null, 'old'], ['add', null, 11, 'new'],
    ])
  })
  it('reads hunk headers without counts and the "no newline" marker', () => {
    const rows = parseDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n')
    assert.deepEqual(rows.map((r) => [r.kind, r.text]), [['hunk', '@@ -1 +1 @@'], ['del', 'a'], ['meta', 'No newline at end of file'], ['add', 'b']])
  })
  it('never shows the git header as code when there is no hunk', () => {
    const binary = parseDiff('diff --git a/logo.png b/logo.png\nnew file mode 100644\nindex 0000000..e69de29\nBinary files /dev/null and b/logo.png differ\n')
    assert.deepEqual(binary.map((r) => [r.kind, r.text]), [['meta', 'new file mode 100644'], ['meta', 'Binary files /dev/null and b/logo.png differ']])
    const chmod = parseDiff('diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n')
    assert.deepEqual(chmod.map((r) => r.text), ['old mode 100644', 'new mode 100755'])
    assert.ok(chmod.every((r) => r.old === null && r.new === null))
  })
  it('gives nothing for an empty answer (a new folder), so the view can say so', () => {
    assert.deepEqual(parseDiff(''), [])
  })
})

describe('control center: time with AI', () => {
  const H = 3600_000
  const day = new Date(2026, 9, 20).getTime() // a local midnight
  const s = (agent: string, repo: string | null, start: number, end: number | null, via = 'terminal') => ({ agent, repo, via, start, end })

  it('counts overlapping time once', () => {
    assert.equal(unionMs([[0, 10], [5, 15], [20, 25]]), 20)
    assert.equal(unionMs([]), 0)
  })
  it('gives calendar days, oldest first, ending today', () => {
    const days = lastDays(3, day + 5 * H)
    assert.equal(days.length, 3)
    assert.equal(days[2], day)
    assert.ok(days.every((d) => new Date(d).getHours() === 0))
  })
  it('splits a session across midnight and counts parallel sessions of one agent once', () => {
    const days = [day - 24 * H, day]
    const rows = agentTimeByDay([
      s('claude', '/r', day - 2 * H, day + 1 * H), // 2 h yesterday, 1 h today
      s('claude', '/r', day, day + 1 * H),         // same agent, same hour: not twice
      s('codex', '/r', day + 2 * H, null),         // still running
      s('chatgpt', null, day, day + 5 * H, 'app'), // an open AI app is not work
    ], days, day + 3 * H)
    assert.deepEqual(rows[0].byAgent, { claude: 2 * H })
    assert.deepEqual(rows[1].byAgent, { claude: 1 * H, codex: 1 * H })
  })
  it('ranks projects by time inside the range', () => {
    const rows = timeBy([s('claude', '/a', day - 10 * H, day + H), s('codex', '/b', day, day + 3 * H)], (x) => x.repo, day, day + 4 * H)
    assert.deepEqual(rows.map((r) => [r.key, r.ms / H]), [['/b', 3], ['/a', 1]])
  })
  it('tells when and with which agents each project was last worked on', () => {
    const rows = lastActivity([s('claude', '/a', day - 48 * H, day - 47 * H), s('codex', '/b', day, day + H), s('gemini', '/b', day + H, day + 2 * H)], day - 24 * H, day + 5 * H)
    assert.deepEqual(rows.map((r) => [r.repo, r.agents.sort()]), [['/b', ['codex', 'gemini']], ['/a', []]])
    assert.equal(rows[0].last, day + 2 * H)
  })
})
