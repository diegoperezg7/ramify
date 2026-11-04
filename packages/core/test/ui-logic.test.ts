import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { levels, nextAction, taskSlug } from '../../../ui/web/src/logic.ts'
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
