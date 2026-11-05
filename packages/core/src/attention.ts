// What needs the user: sessions that wait for them or are about to cause trouble, and branches ready to merge.
// Pure functions: the desktop app feeds them its scans and turns the answers into the menu bar, cards and notifications.
import type { AgentSession, BranchHealth, PullRequest, SessionGlance } from './types.ts'

/** Why a session needs the user, most urgent first. */
export type AttentionReason = 'waiting' | 'shared' | 'main' | 'ready'
const ORDER: AttentionReason[] = ['waiting', 'shared', 'main', 'ready']
const SHARED_BRANCH = /^(main|master|trunk|develop)$/

/**
 * A branch is ready to merge when it has commits of its own, nothing left uncommitted, nothing new in the base to
 * bring in, no other branch touching the same files and no agent still working in it. A draft or closed pull request
 * says it is not done yet; an open one (or none) is fine.
 */
export function mergeReady(b: BranchHealth, busy: boolean, pr?: PullRequest | null): boolean {
  if (b.main || b.merged || busy || b.running.length > 0) return false
  if (pr && (pr.state !== 'OPEN' || pr.draft)) return false
  return b.ahead > 0 && b.uncommitted === 0 && b.behind === 0 && b.overlaps.length === 0
}

/** `${repo}#${branch}`: how a ready branch is told apart. */
export const branchKey = (repo: string, branch: string) => `${repo}#${branch}`

/**
 * Why an open session needs the user: it waits for an answer, it works on the same branch as another agent at work,
 * it works straight on the shared branch, or it stopped on a branch that is ready to merge.
 */
export function sessionAttention(s: AgentSession, open: AgentSession[], ready: Set<string>): AttentionReason[] {
  if (s.end !== null || s.inferred || s.via === 'app') return []
  const out = new Set<AttentionReason>()
  if (s.state === 'waiting') out.add('waiting')
  const busy = s.state === 'working' || s.state === 'waiting'
  if (busy && s.repo && s.branch && open.some((o) => o !== s && o.end === null && !o.inferred && o.repo === s.repo && o.branch === s.branch && (o.state === 'working' || o.state === 'waiting'))) out.add('shared')
  if (s.state === 'working' && s.repo && s.branch && SHARED_BRANCH.test(s.branch)) out.add('main')
  if (s.state !== 'working' && s.repo && s.branch && ready.has(branchKey(s.repo, s.branch))) out.add('ready')
  return ORDER.filter((r) => out.has(r))
}

/** What needs the user in all: sessions with a reason, plus ready branches no open session stands for. */
export function attentionCount(open: AgentSession[], ready: Set<string>): number {
  const flagged = open.filter((s) => sessionAttention(s, open, ready).length > 0)
  const covered = new Set(flagged.filter((s) => s.repo && s.branch).map((s) => branchKey(s.repo!, s.branch!)))
  return flagged.length + [...ready].filter((k) => !covered.has(k)).length
}

/** A session's last step in words, for the menu bar: "Editando MEMORY.md". */
export function actionWords(a: NonNullable<SessionGlance['action']>, es: boolean): string {
  const on = a.target ? ` ${a.target}` : ''
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(a.tool)) return (es ? 'Editando' : 'Editing') + on
  if (a.tool === 'Read') return (es ? 'Leyendo' : 'Reading') + on
  if (a.tool === 'Bash') return (es ? 'Ejecutando' : 'Running') + on
  if (a.tool === 'Grep' || a.tool === 'Glob') return (es ? 'Buscando' : 'Searching') + on
  if (a.tool === 'Task' || a.tool === 'Agent') return es ? 'Lanzando un subagente' : 'Starting a subagent'
  if (a.tool === 'WebFetch' || a.tool === 'WebSearch') return es ? 'Buscando en la web' : 'Searching the web'
  if (a.tool === 'TodoWrite') return es ? 'Actualizando sus tareas' : 'Updating its tasks'
  return `${es ? 'Usando' : 'Using'} ${a.tool.replace(/^mcp__[^_]+__/, '')}`
}

/** "hace 45 min" / "45 min ago", rounded the way a glance needs. */
export function agoWords(ms: number, es: boolean): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return es ? 'ahora' : 'now'
  const v = m < 60 ? `${m} min` : m < 24 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`
  return es ? `hace ${v}` : `${v} ago`
}
