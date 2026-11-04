import { GitBranch, GitMerge, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { agentVar } from '../agents'
import { bridge } from '../bridge'
import { useStore } from '../store'
import type { Timeline as TimelineData, TimelineBranch } from '../types'
import { AgentBadge } from './AgentBadge'

const RANGES = [7, 30, 90, 0] as const
type Range = (typeof RANGES)[number]
const MIN_ROW = 40
const MAX_ROW = 64
const AXIS = 30
const MAX_ROWS = 60

function loadRange(): Range {
  try { const v = Number(localStorage.getItem('ramify-timeline-range')); return (RANGES as readonly number[]).includes(v) ? (v as Range) : 30 } catch { return 30 }
}

/** Time axis marks, as ages: the axis gives recent time more room, so marks are picked by age. */
const AGES = [3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 4 * 86400, 7 * 86400, 14 * 86400, 30 * 86400, 60 * 86400, 120 * 86400, 240 * 86400, 365 * 86400]
/** Under about three hours the axis is nearly linear; older time is compressed logarithmically. */
const K = 3 * 3600

const end = (b: TimelineBranch, now: number) => Math.max(b.merge?.time ?? 0, b.commits.at(-1)?.time ?? b.fork.time, b.live ? now : 0)

export function Timeline() {
  const repo = useStore((s) => s.repo)
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const setView = useStore((s) => s.setView)
  const select = useStore((s) => s.select)
  const [range, setRange] = useState<Range>(loadRange)
  const [data, setData] = useState<TimelineData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(900)
  const [boardH, setBoardH] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const board = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    // One load at a time: on a long history a load can take longer than the refresh interval.
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const d = await bridge.timeline(repo, range)
        if (alive) { setData(d); setError(null) }
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally { busy = false }
    }
    void load()
    const id = setInterval(() => { if (!document.hidden) void load() }, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [repo, range])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)))
    ro.observe(el)
    // The board takes the free height of the view; rows grow to fill it.
    const rb = new ResizeObserver(([e]) => setBoardH(e.contentRect.height))
    if (board.current) rb.observe(board.current)
    return () => { ro.disconnect(); rb.disconnect() }
  }, [data])

  const pickRange = (r: Range) => { setRange(r); try { localStorage.setItem('ramify-timeline-range', String(r)) } catch { /* storage off */ } }
  const fmtFull = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const ago = (age: number) => (age < 86400 ? rtf.format(-Math.round(age / 3600), 'hour') : rtf.format(-Math.round(age / 86400), 'day'))

  const layout = useMemo(() => {
    if (!data) return null
    const branches = data.branches.slice(0, MAX_ROWS)
    // Zoom to where the branches are: a 30-day range whose work is all from yesterday would
    // otherwise squeeze every branch against the right edge.
    let first = data.now
    for (const b of branches) for (const time of [b.fork.time, b.commits[0]?.time ?? b.fork.time, b.merge?.time ?? data.now]) if (time >= data.from) first = Math.min(first, time)
    const from = Math.max(data.from, first - Math.max(2 * 3600, (data.now - first) * 0.06))
    // Logarithmic in age: the last hours and days, where agents are working, get most of the width.
    const pad = 14
    const right = 22
    const span = Math.log1p(Math.max(K, data.now - from) / K)
    const x = (time: number) => pad + (1 - Math.log1p(Math.max(0, Math.min(data.now - from, data.now - time)) / K) / span) * (width - pad - right)
    const marks: number[] = []
    for (const age of AGES) {
      if (age >= data.now - from) break
      const xa = x(data.now - age)
      if (!marks.length || x(data.now - marks.at(-1)!) - xa >= 70) marks.push(age)
    }
    const row = Math.max(MIN_ROW, Math.min(MAX_ROW, Math.floor((boardH - AXIS - 6) / (branches.length + 1))))
    // Grid lines run to the bottom of the board even when a few rows do not fill it.
    return { branches, from, x, marks, row, height: Math.max(AXIS + row * (branches.length + 1) + 6, Math.floor(boardH)) }
  }, [data, width, boardH])

  const statusLabel = (b: TimelineBranch) => t(b.status === 'merged' ? 'tlMerged' : b.status === 'stale' ? 'tlStale' : 'tlActive')
  const ROW = layout?.row ?? MIN_ROW
  const yBase = AXIS + ROW / 2
  const yRow = (i: number) => AXIS + ROW * (i + 1) + ROW / 2

  return (
    <main className="timeline">
      <header className="sessions-head">
        <div>
          <h1>{t('tlTitle')}</h1>
          <p className="muted small">{t('tlHint', { base: data?.base ?? '…' })}</p>
        </div>
        <div className="seg" role="tablist" aria-label={t('tlRange')}>
          {RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-on' : ''} onClick={() => pickRange(r)}>
              {r ? t('days', { n: r }) : t('sessionsAll')}
            </button>
          ))}
        </div>
      </header>

      <div className="tl-legend" aria-hidden="true">
        <span><i className="tl-key is-active" />{t('tlActive')}</span>
        <span><i className="tl-key is-merged" />{t('tlMerged')}</span>
        <span><i className="tl-key is-stale" />{t('tlStale')}</span>
        <span><GitMerge size={13} />{t('tlMergeNode')}</span>
      </div>

      {error && <p className="ob-note is-error">{error}</p>}
      {!data && !error && <p className="muted small"><Loader2 size={14} className="spin" /> …</p>}
      {data && layout && data.branches.length === 0 && <p className="muted">{t('tlEmpty')}</p>}

      {data && layout && data.branches.length > 0 && (
        <div className="tl-board" ref={board}>
          <ul className="tl-labels" style={{ paddingTop: AXIS }}>
            <li className="tl-label is-base" style={{ height: ROW }}><GitBranch size={14} /><b className="mono">{data.base}</b><span className="muted small">{t('tlBase')}</span></li>
            {layout.branches.map((b) => (
              <li key={`${b.name}:${b.merge?.hash ?? 'tip'}`} className={`tl-label is-${b.status}`} style={{ height: ROW }}>
                <button type="button" className="tl-label-btn" disabled={!b.worktree}
                  onClick={() => { if (b.worktree) { setView('repo'); select(b.worktree) } }}
                  title={`${b.name}\n${statusLabel(b)} · ${t('tlCommits', { n: b.commits.length })}`}>
                  {b.agent ? <AgentBadge agent={b.agent} size={18} live={b.live} /> : <GitBranch size={14} className="muted" />}
                  <span className="mono tl-name">{b.name}</span>
                  <span className={`tl-status is-${b.status}`}>{statusLabel(b)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="tl-plot" ref={wrap}>
            <svg width={width} height={layout.height} role="img" aria-label={t('tlTitle')}>
              {layout.marks.map((age) => (
                <g key={age}>
                  <line className="tl-grid" x1={layout.x(data.now - age)} x2={layout.x(data.now - age)} y1={AXIS - 6} y2={layout.height} />
                  <text className="tl-tick" x={layout.x(data.now - age)} y={AXIS - 12} textAnchor="middle">{ago(age)}</text>
                </g>
              ))}
              <line className="tl-now" x1={layout.x(data.now)} x2={layout.x(data.now)} y1={AXIS - 6} y2={layout.height} />

              {/* base lane */}
              <line className="tl-base" x1={layout.x(layout.from)} x2={layout.x(data.now)} y1={yBase} y2={yBase} />
              {data.baseCommits.filter((c) => c.time >= layout.from).map((c) => (
                <circle key={c.hash} className="tl-base-dot" cx={layout.x(c.time)} cy={yBase} r={3}>
                  <title>{`${c.subject}\n${fmtFull.format(c.time * 1000)} · ${c.hash.slice(0, 7)}`}</title>
                </circle>
              ))}

              {layout.branches.map((b, i) => {
                const y = yRow(i)
                const color = b.agent ? agentVar(b.agent) : 'var(--lane-base)'
                const xf = layout.x(b.fork.time)
                const xs = layout.x(Math.max(b.fork.time, b.commits[0]?.time ?? b.fork.time))
                const xe = Math.max(xf, layout.x(end(b, data.now)))
                const forkVisible = b.fork.time >= layout.from
                const r = 10
                // Fork and merge are short hooks that leave the row upwards, towards the base branch,
                // instead of long verticals that cross every row in between.
                const top = y - 12
                const xm = b.merge ? layout.x(b.merge.time) : 0
                return (
                  <g key={`${b.name}:${b.merge?.hash ?? 'tip'}`} className={`tl-branch is-${b.status}`} style={{ ['--c' as string]: color }}>
                    <title>{`${b.name} · ${statusLabel(b)} · ${t('tlCommits', { n: b.commits.length })}`}</title>
                    {forkVisible && <path className="tl-link" d={`M${xf},${top} V${y - r} Q${xf},${y} ${xf + r},${y} H${Math.max(xf + r, xs)}`} />}
                    <line className="tl-bar" x1={forkVisible ? xf + r : layout.x(layout.from)} x2={Math.max(xe, xs + 2)} y1={y} y2={y} />
                    {b.merge && (
                      <>
                        <path className="tl-link" d={`M${xe},${y} H${Math.max(xe, xm - r)} Q${xm},${y} ${xm},${y - r} V${top}`} />
                        <circle className="tl-merge" cx={layout.x(b.merge.time)} cy={yBase} r={5}>
                          <title>{`${t('tlMergeNode')}: ${b.name} → ${data.base}\n${fmtFull.format(b.merge.time * 1000)}`}</title>
                        </circle>
                      </>
                    )}
                    {/* A commit never sits before its fork (clock skew, rewritten dates). */}
                    {b.commits.filter((c) => c.time >= layout.from).map((c) => (
                      <circle key={c.hash} className="tl-dot" cx={Math.max(forkVisible ? xf + r : 0, layout.x(c.time))} cy={y} r={4.5}>
                        <title>{`${c.subject}\n${fmtFull.format(c.time * 1000)} · ${c.hash.slice(0, 7)}`}</title>
                      </circle>
                    ))}
                    {b.live && <><circle className="tl-live-halo" cx={xe} cy={y} r={5} /><circle className="tl-live" cx={xe} cy={y} r={5} /></>}
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      )}
      {data && data.branches.length > MAX_ROWS && <p className="muted small">{t('tlMore', { n: data.branches.length - MAX_ROWS })}</p>}
    </main>
  )
}
