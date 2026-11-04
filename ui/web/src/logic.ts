// Pure helpers of the interface, kept apart from React so they can be tested on their own.
import type { BranchHealth, PullRequest } from './types.ts'

export type Action = 'move' | 'update' | 'pr' | 'merge' | 'remove' | 'open' | 'launch' | 'view-pr'

/** The one thing a branch needs next, in the order a reviewer would ask for it. */
export function nextAction(b: BranchHealth, pr: PullRequest | undefined, onGithub: boolean): Action {
  if (b.main) return 'move'
  if (b.merged || pr?.state === 'MERGED') return 'remove'
  if (b.behind > 0 && !b.uncommitted) return 'update'
  if (b.ahead > 0 && !pr && onGithub) return 'pr'
  if (pr?.state === 'OPEN') return 'view-pr'
  return 'open'
}


/** "Add login with magic links" → "add-login-with-magic-links" (ASCII, short, safe for a branch). */
export function taskSlug(task: string): string {
  return task.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-').slice(0, 40).replace(/-+$/, '')
}

/** Five steps of one hue: none, then quartiles of the busy days (the scale GitHub uses). */
export function levels(counts: number[]): (n: number) => 0 | 1 | 2 | 3 | 4 {
  const busy = counts.filter((n) => n > 0).sort((a, b) => a - b)
  const q = (p: number) => busy[Math.min(busy.length - 1, Math.floor(p * busy.length))] ?? 1
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)]
  return (n) => (n <= 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4)
}

