import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { agentTimeByDay, dayLanes, friendlyMerge, lastActivity, MergeError, mergeProblem, lastDays, levels, nextAction, parseDiff, peakParallel, shellArg, splitMinor, taskSlug, timeBy, unionMs } from '../../../ui/web/src/logic.ts'
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

describe('control center: one day hour by hour', () => {
  const H = 3600_000
  const day = new Date(2026, 9, 20).getTime()
  const next = new Date(2026, 9, 21).getTime()
  const s = (agent: string, start: number, end: number | null, via = 'terminal') => ({ agent, repo: '/r', via, start, end })

  it('gives each agent one lane with its sessions merged and clipped to the day', () => {
    const lanes = dayLanes([s('claude', day - H, day + 2 * H), s('claude', day + H, day + 3 * H), s('codex', day + 5 * H, null), s('chatgpt', day, day + H, 'app')], day, next, day + 6 * H)
    assert.deepEqual(lanes.map((l) => [l.agent, l.spans.map(([a, b]) => [(a - day) / H, (b - day) / H])]), [['claude', [[0, 3]]], ['codex', [[5, 6]]]])
  })
  it('finds the most sessions at once, without counting a hand-over as two', () => {
    const p = peakParallel([s('claude', day, day + 2 * H), s('codex', day + H, day + 3 * H), s('gemini', day + 3 * H, day + 4 * H)], day, next, next)
    assert.deepEqual(p, { n: 2, at: day + H })
    assert.equal(peakParallel([], day, next, next).n, 0)
  })
  it('folds agents with a sliver of the time into others', () => {
    assert.deepEqual(splitMinor([['claude', 600], ['codex', 300], ['qwen', 10], ['opencode', 5]]), { main: ['claude', 'codex'], minor: ['qwen', 'opencode'] })
  })
})

describe('merge notification', () => {
  const ctx = { branch: 'feat/x', base: 'main', path: '/wts/feat-x' }
  it('says it in one line instead of git output, and another when generated files were rebuilt', async () => {
    assert.deepEqual(await friendlyMerge(async () => ({ message: ' a.ts | 3 ++-\n 1 file changed' }), ctx, 'ok', 'rebuilt'), { message: 'ok', rebuilt: false })
    assert.deepEqual(await friendlyMerge(async () => ({ message: 'merged feat/x; regenerated: ui/dist/index.html' }), ctx, 'ok', 'rebuilt'), { message: 'rebuilt', rebuilt: true })
  })
  it('says when it went in on GitHub, when main here stayed behind, and when main was not pushed', async () => {
    const words = { github: (n: string) => `gh #${n}`, githubStale: (n: string, why: string) => `gh #${n}, stale: ${why}`, notPushed: (why: string) => `not pushed: ${why}` }
    const merged = async (message: string) => (await friendlyMerge(async () => ({ message }), ctx, 'ok', 'rebuilt', words)).message
    assert.equal(await merged('merged on GitHub: #12 (squash)\nfeat/x deleted on GitHub\nmain ← origin/main (1 commit(s))'), 'gh #12')
    assert.equal(await merged('merged on GitHub: #12 (squash)\nnot updated here: local changes in the way'), 'gh #12, stale: local changes in the way')
    assert.equal(await merged('Merge made by the ort strategy.\nnot pushed to origin/main: rejected (protected branch)'), 'not pushed: rejected (protected branch)')
    assert.equal(await merged('Merge made by the ort strategy.\npushed to origin/main'), 'ok')
  })
  it('turns a failed merge into the reason and the files, for a dialog', async () => {
    const conflict = 'merge conflict, nothing was changed:\nconflict: src/a.ts\nconflict: README.md\nCONFLICT (content): Merge conflict in src/a.ts'
    await assert.rejects(friendlyMerge(async () => { throw new Error(conflict) }, ctx, 'ok', 'rebuilt'),
      (e: unknown) => e instanceof MergeError && e.problem.kind === 'conflict' && e.problem.files.join() === 'src/a.ts,README.md' && e.problem.path === '/wts/feat-x')
  })
  it('reads every reason, also from older hosts and through Electron\'s error prefix', () => {
    assert.deepEqual(mergeProblem("Error invoking remote method 'ramify': EngineError: merge conflict, nothing was changed:\nCONFLICT (content): Merge conflict in a.ts", ctx).files, ['a.ts'])
    assert.equal(mergeProblem('the main checkout has uncommitted changes', ctx).kind, 'dirty-main')
    assert.equal(mergeProblem('the worktree has uncommitted changes', ctx).kind, 'dirty-branch')
    const g = mergeProblem('generated files could not be rebuilt, nothing was changed:\nsh: npm: command not found', ctx)
    assert.equal(g.kind, 'generated'); assert.equal(g.detail, 'sh: npm: command not found')
    assert.deepEqual([mergeProblem('nothing to merge', ctx).kind, mergeProblem('nothing to merge', ctx).detail], ['other', 'nothing to merge'])
  })
})

describe('commands to copy', () => {
  it('quotes a branch name a shell would run', () => {
    assert.equal(shellArg('feat/login-2'), 'feat/login-2')
    assert.equal(shellArg('x;open${IFS}-a${IFS}Calculator'), "'x;open${IFS}-a${IFS}Calculator'")
    assert.equal(shellArg("it's"), "'it'\\''s'")
  })
})
