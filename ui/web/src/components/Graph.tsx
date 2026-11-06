import { Cloud, Tag } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { agentVar } from '../agents'
import { layout } from '../graph'
import { relTime } from '../i18n'
import { prFor, squashMerged } from '../logic'
import { useStore } from '../store'
import type { PullRequest, Worktree } from '../types'
import { PrChip } from './PrChip'

const LANE = 26
const PAD = 18
// The graph column is shared by the svg, the rows and the "Graph" header label:
// it must never be narrower than that label, even with a single lane.
const GRAPH_MIN = 76
// A merged branch's lane turns into the trunk one step at a time, from the merge down to where it forked.
const JOIN_MS = 550
const JOIN_STEP = 110
const JOIN_STEPS_MAX = 12

/** `onPick`: what a click on a commit does instead of opening it beside the graph (the editor's side bar opens the dashboard). */
export function Graph({ onPick }: { onPick?: (hash: string) => void } = {}) {
  const state = useStore((s) => s.state)!
  const selected = useStore((s) => s.selected)
  const openCommit = useStore((s) => s.commit)
  const selectCommit = useStore((s) => s.selectCommit)
  const lang = useStore((s) => s.lang)
  const t = useStore((s) => s.t)
  const ROW = useStore((s) => (s.density === 'compact' ? 28 : 36))

  const g = useMemo(() => layout(state.commits), [state.commits])
  const byBranch = useMemo(() => new Map(state.worktrees.map((w) => [w.branch, w])), [state.worktrees])
  const selectedBranch = state.worktrees.find((w) => w.path === selected)?.branch || null // '' (detached) highlights nothing
  const prs = useStore((s) => s.prs)
  // Squashed on GitHub: its commits never reach the base, so its lane would look unfinished until its worktree goes.
  // It is shown dimmed, its pull request marked merged; nothing is hidden.
  const squashed = useMemo(() => {
    const out = new Set<string>()
    for (const commit of state.commits) {
      for (const raw of commit.refs) {
        const ref = cleanRef(raw)
        if (!ref.startsWith('tag: ') && squashMerged(prFor(prs, ref), commit.hash)) out.add(ref)
      }
    }
    return out
  }, [state.commits, prs])

  // Everything is "new" on the first render (the tree draws itself in); afterwards only
  // commits and lines that appear between refreshes animate in.
  const seen = useRef<Set<string> | null>(null)
  const first = seen.current === null
  const fresh = (id: string) => first || !seen.current!.has(id)
  useEffect(() => {
    seen.current = new Set([...g.rows.map((r) => r.commit.hash), ...g.edges.map((e) => e.id)])
  }, [g])

  // The base is the trunk, in the brand violet; a worktree's branch takes its agent's colour; a branch without one, a neutral lane.
  const colorOf = (owner: string | null) => {
    if (!owner) return 'var(--lane-main)'
    const w = byBranch.get(owner)
    return w ? agentVar(w.agent) : 'var(--lane-branch)'
  }
  // A branch merged into the base: its commits and lines went from a branch's colour to the base's between two
  // refreshes. Only how they look changes, for a moment; layout and data stay as they came.
  // A layout effect, so the trunk colour never shows for a frame before the animation starts.
  const lastColor = useRef<Map<string, string> | null>(null)
  const [joining, setJoining] = useState<Map<string, { from: string; step: number }>>(new Map())
  const joinTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useLayoutEffect(() => {
    const before = lastColor.current
    const now = new Map<string, string>()
    for (const { commit } of g.rows) now.set(commit.hash, colorOf(commit.owner))
    for (const e of g.edges) now.set(e.id, colorOf(e.owner))
    lastColor.current = now
    if (!before) return
    const found: { id: string; from: string; row: number }[] = []
    g.rows.forEach(({ commit }, r) => {
      const was = before.get(commit.hash)
      if (!commit.owner && was && was !== now.get(commit.hash)) found.push({ id: commit.hash, from: was, row: r })
    })
    for (const e of g.edges) {
      const was = before.get(e.id)
      if (!e.owner && was && was !== now.get(e.id)) found.push({ id: e.id, from: was, row: e.row })
    }
    if (!found.length) return
    const top = Math.min(...found.map((f) => f.row))
    setJoining(new Map(found.map((f) => [f.id, { from: f.from, step: Math.min(f.row - top, JOIN_STEPS_MAX) }])))
    // Not tied to this effect: a refresh in the middle must not leave the animation on for good.
    clearTimeout(joinTimer.current)
    joinTimer.current = setTimeout(() => setJoining(new Map()), JOIN_MS + JOIN_STEPS_MAX * JOIN_STEP + 100)
  }, [g]) // colours follow `g`: a change in the worktree list alone merges nothing
  useEffect(() => () => clearTimeout(joinTimer.current), [])
  const joinStyle = (id: string) => {
    const j = joining.get(id)
    return j ? { ['--from' as string]: j.from, animationDelay: `${j.step * JOIN_STEP}ms`, animationDuration: `${JOIN_MS}ms` } : undefined
  }

  // Another branch is selected, or this one is squashed on GitHub (unless it is the one selected).
  const dimmed = (owner: string | null) => owner !== null && owner !== selectedBranch && (selectedBranch !== null || squashed.has(owner))
  const x = (col: number) => PAD + col * LANE
  const y = (row: number) => row * ROW + ROW / 2
  const graphWidth = Math.max(GRAPH_MIN, PAD * 2 + (g.lanes - 1) * LANE)
  const delay = (row: number) => (first ? `${Math.min(row, 40) * 28}ms` : '0ms')

  const liveTips = new Map<string, string>()
  for (const w of state.worktrees) {
    if (w.main || !w.running.length) continue
    const tip = g.rows.find((r) => r.commit.refs.some((ref) => cleanRef(ref) === w.branch))
    if (tip) liveTips.set(tip.commit.hash, agentVar(w.agent))
  }

  // Uncommitted work of every worktree, shown on the tip of its branch.
  const pending = new Map<string, { count: number; color: string }>()
  for (const w of state.worktrees) {
    if (!w.changes || !w.branch) continue
    const tip = g.rows.find((r) => r.commit.refs.some((ref) => cleanRef(ref) === w.branch))
    if (tip) pending.set(tip.commit.hash, { count: w.changes, color: w.main ? 'var(--lane-main)' : agentVar(w.agent) })
  }

  const agents = [...new Set(state.worktrees.filter((w) => !w.main && w.agent).map((w) => w.agent))]

  return (
    <section className="pane graph-pane">
      <header className="pane-head">
        <h2 title={t('graphHint')}>{t('branchTree')}</h2>
        <ul className="legend" aria-label="agents">
          <li><span className="swatch" style={{ background: 'var(--lane-main)' }} />{state.base}</li>
          {agents.map((a) => (
            <li key={a}><span className="swatch" style={{ background: agentVar(a) }} />{a}</li>
          ))}
        </ul>
      </header>

      <div className="graph-cols" style={{ ['--gw' as string]: `${graphWidth}px` }}>
        <span>{t('colGraph')}</span><span>{t('colMessage')}</span><span className="col-date">{t('colDate')}</span><span className="col-hash">{t('colCommit')}</span>
      </div>
      <div className="graph-scroll">
        <div className="graph" style={{ height: g.rows.length * ROW }}>
          <svg className="graph-svg" width={graphWidth} height={g.rows.length * ROW} aria-hidden="true">
            {g.edges.map((e) => {
              const x1 = x(e.from), x2 = x(e.to), y1 = y(e.row)
              const y2 = e.last ? y1 + ROW / 2 : y(e.row + 1)
              const d = x1 === x2
                ? `M${x1} ${y1} L${x2} ${y2}`
                : `M${x1} ${y1} C${x1} ${y1 + ROW * 0.55} ${x2} ${y2 - ROW * 0.55} ${x2} ${y2}`
              const isNew = fresh(e.id)
              const join = joinStyle(e.id)
              return (
                <path key={e.id} d={d} fill="none" stroke={colorOf(e.owner)} strokeWidth={3}
                  strokeLinecap="round" opacity={dimmed(e.owner) ? 0.2 : 1}
                  className={`edge${isNew ? ' is-new' : ''}${e.last ? ' is-last' : ''}${join ? ' is-joining' : ''}`}
                  pathLength={isNew && !e.last ? 1 : undefined}
                  style={{ d: `path("${d}")`, animationDelay: delay(e.row), ...join } as CSSProperties} />
              )
            })}
            {g.rows.filter(({ commit }) => liveTips.has(commit.hash)).map(({ commit, col }) => {
              const r = g.rows.findIndex((x) => x.commit.hash === commit.hash)
              return <circle key={`live-${commit.hash}`} className="node-live" cx={x(col)} cy={y(r)} r={6} fill={liveTips.get(commit.hash)} opacity={0.4} />
            })}
            {g.rows.map(({ commit, col }, r) => {
              const p = pending.get(commit.hash)
              return p ? <circle key={`pending-${commit.hash}`} className="node-pending" cx={x(col)} cy={y(r)} r={10} stroke={p.color} /> : null
            })}
            {g.rows.map(({ commit, col }, r) => {
              const merge = commit.parents.length > 1
              return (
                <circle key={commit.hash} cx={x(col)} cy={y(r)} r={merge ? 4.5 : 6}
                  className={`node${merge ? ' is-merge' : ''}${fresh(commit.hash) ? ' is-new' : ''}${joining.has(commit.hash) ? ' is-joining' : ''}`}
                  style={{ cx: x(col), cy: y(r), animationDelay: delay(r), ...joinStyle(commit.hash) } as CSSProperties}
                  fill={merge ? 'var(--bg)' : colorOf(commit.owner)} stroke={merge ? colorOf(commit.owner) : 'var(--bg)'}
                  strokeWidth={merge ? 2.5 : 2} opacity={dimmed(commit.owner) ? 0.25 : 1} />
              )
            })}
          </svg>

          {g.rows.map(({ commit }, r) => {
            const wt = commit.owner ? byBranch.get(commit.owner) : undefined
            const tipWt = commit.refs.map(cleanRef).map((ref) => byBranch.get(ref)).find(Boolean)
            const target = wt ?? tipWt
            return (
              <button key={commit.hash} type="button"
                className={`graph-row${commit.owner ? ' is-branch' : ''}${dimmed(commit.owner) ? ' is-dim' : ''}${openCommit === commit.hash || (!openCommit && target && target.path === selected) ? ' is-selected' : ''}${fresh(commit.hash) ? ' is-new' : ''}`}
                style={{ top: r * ROW, height: ROW, paddingLeft: graphWidth, animationDelay: delay(r), ['--c' as string]: colorOf(commit.owner) }}
                aria-pressed={openCommit === commit.hash}
                onClick={() => (onPick ? onPick(commit.hash) : selectCommit(openCommit === commit.hash ? null : commit.hash))}
                title={`${commit.hash}\n${commit.author} · ${new Date(commit.time * 1000).toLocaleString(lang)}`}>
                <span className="refs">
                  {commit.refs.map((ref) => <RefPill key={ref} raw={ref} byBranch={byBranch} prs={prs} />)}
                  {pending.has(commit.hash) && (
                    <span className="ref ref-pending" style={{ ['--c' as string]: pending.get(commit.hash)!.color }}>
                      +{pending.get(commit.hash)!.count} {t('uncommittedShort')}
                    </span>
                  )}
                </span>
                <span className="subject">{commit.subject}</span>
                <span className="meta">
                  <span>{relTime(lang, commit.time, state.now)}</span>
                  <code>{commit.hash.slice(0, 7)}</code>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function cleanRef(raw: string): string {
  return raw.replace(/^HEAD -> /, '')
}

function RefPill({ raw, byBranch, prs }: { raw: string; byBranch: Map<string, Worktree>; prs: PullRequest[] }) {
  if (raw === 'HEAD') return null
  const head = raw.startsWith('HEAD -> ')
  const ref = cleanRef(raw)
  if (ref.startsWith('tag: ')) {
    return <span className="ref ref-tag"><Tag size={11} aria-hidden="true" />{ref.slice(5)}</span>
  }
  const wt = byBranch.get(ref)
  // Read-only, and not a link: the whole row is a button that opens the commit.
  const pr = wt?.main ? undefined : prFor(prs, ref)
  const chip = pr && <PrChip pr={pr} link={false} />
  if (wt) {
    return (
      <>
        <span className={`ref ref-branch${head ? ' is-head' : ''}`} style={{ ['--c' as string]: wt.main ? 'var(--lane-main)' : agentVar(wt.agent) }}>
          <span className="dot" />{ref}{!wt.main && wt.agent && <em>{wt.agent}</em>}
        </span>
        {chip}
      </>
    )
  }
  if (/^(origin|upstream)\//.test(ref)) {
    return <span className="ref ref-remote"><Cloud size={11} aria-hidden="true" />{ref}</span>
  }
  // A local branch without a worktree.
  return <><span className={`ref ref-branch${head ? ' is-head' : ''}`} style={{ ['--c' as string]: 'var(--lane-branch)' }}><span className="dot" />{ref}</span>{chip}</>
}
