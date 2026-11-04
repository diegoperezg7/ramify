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


export type DiffRow = { kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'; old: number | null; new: number | null; text: string }

/** What git says about a change with no text hunks: binary files, permissions, renames, empty new files. */
const DIFF_INFO = /^(Binary files |old mode |new mode |new file mode |deleted file mode |similarity index |rename from |rename to |copy from |copy to )/

/** Unified diff → rows with old and new line numbers, like GitHub's split gutter. Only lines inside a hunk are code. */
export function parseDiff(diff: string): DiffRow[] {
  const all = diff.replace(/\r?\n$/, '').split('\n')
  const start = all.findIndex((l) => l.startsWith('@@'))
  // No hunk: keep the informative header lines (never shown as code), or nothing at all.
  if (start === -1) return all.filter((l) => DIFF_INFO.test(l)).map((text) => ({ kind: 'meta', old: null, new: null, text }))
  const rows: DiffRow[] = []
  let o = 0
  let n = 0
  for (const l of all.slice(start)) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l)
    if (h) { o = Number(h[1]); n = Number(h[2]); rows.push({ kind: 'hunk', old: null, new: null, text: l }); continue }
    if (l.startsWith('\\')) rows.push({ kind: 'meta', old: null, new: null, text: l.slice(2) })
    else if (l.startsWith('+')) rows.push({ kind: 'add', old: null, new: n++, text: l.slice(1) })
    else if (l.startsWith('-')) rows.push({ kind: 'del', old: o++, new: null, text: l.slice(1) })
    else rows.push({ kind: 'ctx', old: o++, new: n++, text: l.slice(1) })
  }
  return rows
}

// --- control center: time with AI --------------------------------------------------------------

type Timed = { agent: string; repo: string | null; via: string; start: number; end: number | null }

/** Total length of a set of time spans, overlapping parts counted once (ms). */
export function unionMs(spans: (readonly [number, number])[]): number {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0, s = 0, e = 0
  for (const [a, b] of sorted) {
    if (a > e) { total += e - s; s = a; e = b } else e = Math.max(e, b)
  }
  return total + e - s
}

/** Local midnights (ms) of the last `n` days, oldest first, by calendar date (so daylight-saving days fit). */
export function lastDays(n: number, now: number): number[] {
  const d = new Date(now)
  return Array.from({ length: n }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (n - 1 - i)).getTime())
}

/** Work sessions only: an AI app left open is not time spent with an agent. */
const work = <T extends Timed>(sessions: T[]) => sessions.filter((s) => s.via !== 'app')

/** Per day, the time each agent worked (its parallel sessions counted once), clipped to the day. */
export function agentTimeByDay(sessions: Timed[], days: number[], now: number): { day: number; byAgent: Record<string, number> }[] {
  const list = work(sessions)
  return days.map((day, i) => {
    const d = new Date(day)
    const next = i + 1 < days.length ? days[i + 1] : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    const spans = new Map<string, [number, number][]>()
    for (const s of list) {
      const a = Math.max(s.start, day), b = Math.min(s.end ?? now, next)
      if (b > a) spans.set(s.agent, [...(spans.get(s.agent) ?? []), [a, b]])
    }
    return { day, byAgent: Object.fromEntries([...spans].map(([agent, sp]) => [agent, unionMs(sp)])) }
  })
}

/** Time per key (project or agent) since `from`, overlapping sessions of the same key counted once, largest first. */
export function timeBy(sessions: Timed[], key: (s: Timed) => string | null, from: number, now: number): { key: string; ms: number }[] {
  const spans = new Map<string, [number, number][]>()
  for (const s of work(sessions)) {
    const k = key(s)
    const a = Math.max(s.start, from), b = s.end ?? now
    if (k && b > a) spans.set(k, [...(spans.get(k) ?? []), [a, b]])
  }
  return [...spans].map(([k, sp]) => ({ key: k, ms: unionMs(sp) })).filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms)
}

/** The last time each project had an agent, with the agents seen there since `from`; most recent first. */
export function lastActivity(sessions: Timed[], from: number, now: number): { repo: string; last: number; agents: string[]; ms: number }[] {
  const by = new Map<string, { last: number; agents: Set<string>; spans: [number, number][] }>()
  for (const s of work(sessions)) {
    if (!s.repo) continue
    const end = s.end ?? now
    const e = by.get(s.repo) ?? { last: 0, agents: new Set<string>(), spans: [] }
    e.last = Math.max(e.last, end)
    if (end >= from) { e.agents.add(s.agent); e.spans.push([Math.max(s.start, from), end]) }
    by.set(s.repo, e)
  }
  return [...by].map(([repo, e]) => ({ repo, last: e.last, agents: [...e.agents], ms: unionMs(e.spans) })).sort((a, b) => b.last - a.last)
}

/** One day of work, by agent: each agent's sessions clipped to the day, overlaps merged (for an hour-by-hour lane). */
export function dayLanes(sessions: Timed[], day: number, next: number, now: number): { agent: string; spans: [number, number][]; ms: number }[] {
  const by = new Map<string, [number, number][]>()
  for (const s of work(sessions)) {
    const a = Math.max(s.start, day), b = Math.min(s.end ?? now, next)
    if (b > a) by.set(s.agent, [...(by.get(s.agent) ?? []), [a, b]])
  }
  return [...by].map(([agent, sp]) => {
    const merged: [number, number][] = []
    for (const [a, b] of sp.sort((x, y) => x[0] - y[0])) {
      const last = merged[merged.length - 1]
      if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b])
    }
    return { agent, spans: merged, ms: unionMs(merged) }
  }).sort((x, y) => y.ms - x.ms)
}

/** Most agent sessions running at the same moment between `from` and `to`, and when that first happened. */
export function peakParallel(sessions: Timed[], from: number, to: number, now: number): { n: number; at: number | null } {
  const ev: [number, number][] = []
  for (const s of work(sessions)) {
    const a = Math.max(s.start, from), b = Math.min(s.end ?? now, to)
    if (b > a) ev.push([a, 1], [b, -1])
  }
  // Ends before starts at the same instant: a session handing over to the next is not two at once.
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let n = 0, peak = 0, at: number | null = null
  for (const [t, d] of ev) { n += d; if (n > peak) { peak = n; at = t } }
  return { n: peak, at }
}

/** Agents with a real share of the time, in order; the ones under `share` of the total fold into one "others" figure. */
export function splitMinor(totals: [string, number][], share = 0.04): { main: string[]; minor: string[] } {
  const sorted = [...totals].sort((a, b) => b[1] - a[1])
  const sum = sorted.reduce((s, [, ms]) => s + ms, 0)
  const main = sorted.filter(([, ms], i) => i === 0 || ms >= sum * share).map(([a]) => a)
  return { main, minor: sorted.map(([a]) => a).filter((a) => !main.includes(a)) }
}

/**
 * Merge a branch, and say it in one short line: git's own output (every file and +/- count) is too much
 * for a notification. A conflict says so, the details stay in git (nothing was changed).
 */
/** Why a merge did not happen, read from the host's error, for a dialog that says why and what to do next. */
export interface MergeProblem {
  kind: 'conflict' | 'generated' | 'dirty-main' | 'dirty-branch' | 'other'
  /** Files in conflict (conflict), or the rebuild script's last lines (generated) / the raw message (other). */
  files: string[]
  detail: string
  branch: string
  base: string
  /** The branch's worktree: where the conflict gets resolved. */
  path: string
}

export function mergeProblem(message: string, ctx: { branch: string; base: string; path: string }): MergeProblem {
  const m = message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
  const files = [...m.matchAll(/^conflict: (.+)$/gm)].map((x) => x[1].trim())
  // Older hosts: only git's own words.
  if (!files.length) for (const x of m.matchAll(/^CONFLICT \([^)]*\): (?:Merge conflict in )?(\S+)/gm)) files.push(x[1])
  const kind: MergeProblem['kind'] = /generated files could not be rebuilt/i.test(m) ? 'generated'
    : /merge conflict/i.test(m) ? 'conflict'
    : /main checkout has uncommitted/i.test(m) ? 'dirty-main'
    : /worktree has uncommitted/i.test(m) ? 'dirty-branch'
    : 'other'
  const detail = kind === 'generated' ? m.split('\n').slice(1).join('\n').trim() : kind === 'other' ? m : ''
  return { kind, files: [...new Set(files)], detail, ...ctx }
}

/** A merge that did not happen: the UI shows it as a dialog (why, what to do), not as a toast. */
export class MergeError extends Error {
  problem: MergeProblem
  constructor(problem: MergeProblem) { super(problem.detail || problem.kind); this.problem = problem }
}

/**
 * Merge with a short message on success (a different one when generated files were rebuilt along the way)
 * and a MergeError, with its reason, on failure.
 */
export async function friendlyMerge(merge: () => Promise<unknown>, ctx: { branch: string; base: string; path: string }, ok: string, okRebuilt: string): Promise<{ message: string }> {
  let out: unknown
  try { out = await merge() } catch (e) { throw new MergeError(mergeProblem((e as Error).message, ctx)) }
  const said = typeof out === 'string' ? out : (out as { message?: string } | undefined)?.message ?? ''
  return { message: /regenerated: /.test(said) ? okRebuilt : ok }
}
