import { Cloud, Tag } from 'lucide-react'
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { agentVar } from '../agents'
import { layout } from '../graph'
import { relTime } from '../i18n'
import { useStore } from '../store'
import type { Worktree } from '../types'

const LANE = 18
const PAD = 16

export function Graph() {
  const state = useStore((s) => s.state)!
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const lang = useStore((s) => s.lang)
  const t = useStore((s) => s.t)
  const ROW = useStore((s) => (s.density === 'compact' ? 28 : 36))

  const g = useMemo(() => layout(state.commits), [state.commits])
  const byBranch = useMemo(() => new Map(state.worktrees.map((w) => [w.branch, w])), [state.worktrees])
  const selectedBranch = state.worktrees.find((w) => w.path === selected)?.branch ?? null

  // Everything is "new" on the first render (the tree draws itself in); afterwards only
  // commits and lines that appear between refreshes animate in.
  const seen = useRef<Set<string> | null>(null)
  const first = seen.current === null
  const fresh = (id: string) => first || !seen.current!.has(id)
  useEffect(() => {
    seen.current = new Set([...g.rows.map((r) => r.commit.hash), ...g.edges.map((e) => e.id)])
  }, [g])

  const colorOf = (owner: string | null) => (owner ? agentVar(byBranch.get(owner)?.agent) : 'var(--lane-base)')
  const dimmed = (owner: string | null) => selectedBranch !== null && owner !== null && owner !== selectedBranch
  const x = (col: number) => PAD + col * LANE
  const y = (row: number) => row * ROW + ROW / 2
  const graphWidth = PAD * 2 + (g.lanes - 1) * LANE
  const delay = (row: number) => (first ? `${Math.min(row, 40) * 28}ms` : '0ms')

  const agents = [...new Set(state.worktrees.filter((w) => !w.main && w.agent).map((w) => w.agent))]

  return (
    <section className="pane graph-pane">
      <header className="pane-head">
        <h2 title={t('graphHint')}>{t('branchTree')}</h2>
        <ul className="legend" aria-label="agents">
          <li><span className="swatch" style={{ background: 'var(--lane-base)' }} />{state.base}</li>
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
              return (
                <path key={e.id} d={d} fill="none" stroke={colorOf(e.owner)} strokeWidth={2}
                  strokeLinecap="round" opacity={dimmed(e.owner) ? 0.2 : 1}
                  className={`edge${isNew ? ' is-new' : ''}${e.last ? ' is-last' : ''}`}
                  pathLength={isNew && !e.last ? 1 : undefined}
                  style={{ d: `path("${d}")`, animationDelay: delay(e.row) } as CSSProperties} />
              )
            })}
            {g.rows.map(({ commit, col }, r) => {
              const merge = commit.parents.length > 1
              return (
                <circle key={commit.hash} cx={x(col)} cy={y(r)} r={merge ? 4.5 : 5.5}
                  className={`node${fresh(commit.hash) ? ' is-new' : ''}`}
                  style={{ cx: x(col), cy: y(r), animationDelay: delay(r) } as CSSProperties}
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
                className={`graph-row${dimmed(commit.owner) ? ' is-dim' : ''}${target && target.path === selected ? ' is-selected' : ''}${fresh(commit.hash) ? ' is-new' : ''}`}
                style={{ top: r * ROW, height: ROW, paddingLeft: graphWidth, animationDelay: delay(r) }}
                onClick={() => target && select(target.path)}
                title={`${commit.hash}\n${commit.author} · ${new Date(commit.time * 1000).toLocaleString(lang)}`}>
                <span className="refs">
                  {commit.refs.map((ref) => <RefPill key={ref} raw={ref} byBranch={byBranch} />)}
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

function RefPill({ raw, byBranch }: { raw: string; byBranch: Map<string, Worktree> }) {
  if (raw === 'HEAD') return null
  const head = raw.startsWith('HEAD -> ')
  const ref = cleanRef(raw)
  if (ref.startsWith('tag: ')) {
    return <span className="ref ref-tag"><Tag size={11} aria-hidden="true" />{ref.slice(5)}</span>
  }
  const wt = byBranch.get(ref)
  if (wt) {
    return (
      <span className={`ref ref-branch${head ? ' is-head' : ''}`} style={{ ['--c' as string]: wt.main ? 'var(--lane-base)' : agentVar(wt.agent) }}>
        <span className="dot" />{ref}{!wt.main && wt.agent && <em>{wt.agent}</em>}
      </span>
    )
  }
  if (/^(origin|upstream)\//.test(ref)) {
    return <span className="ref ref-remote"><Cloud size={11} aria-hidden="true" />{ref}</span>
  }
  return <span className="ref">{ref}</span>
}
