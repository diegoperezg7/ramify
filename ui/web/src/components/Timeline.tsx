import { GitBranch, GitMerge, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { agentVar } from '../agents'
import { bridge } from '../bridge'
import { useStore } from '../store'
import type { Timeline as TimelineData, TimelineBranch } from '../types'
import { AgentBadge } from './AgentBadge'

const RANGES = [7, 30, 90, 0] as const
type Range = (typeof RANGES)[number]
const ROW = 40
const AXIS = 30
const MAX_ROWS = 60

function loadRange(): Range {
  try { const v = Number(localStorage.getItem('ramify-timeline-range')); return (RANGES as readonly number[]).includes(v) ? (v as Range) : 30 } catch { return 30 }
}

/** Evenly spaced time ticks: days, weeks or months depending on the span. */
export function ticks(from: number, to: number): number[] {
  const span = to - from
  const day = 86400
  const step = span <= 10 * day ? day : span <= 70 * day ? 7 * day : 30 * day
  const first = Math.ceil(from / step) * step
  const out: number[] = []
  for (let t = first; t <= to && out.length < 40; t += step) out.push(t)
  return out
}

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
  const wrap = useRef<HTMLDivElement>(null)

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
    return () => ro.disconnect()
  }, [data])

  const pickRange = (r: Range) => { setRange(r); try { localStorage.setItem('ramify-timeline-range', String(r)) } catch { /* storage off */ } }
  const fmtDay = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
  const fmtFull = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const layout = useMemo(() => {
    if (!data) return null
    const branches = data.branches.slice(0, MAX_ROWS)
    const from = data.from
    const to = data.now + Math.max(3600, (data.now - from) * 0.02)
    const pad = 14
    const x = (time: number) => pad + ((Math.max(from, Math.min(to, time)) - from) / (to - from)) * (width - pad * 2)
    return { branches, from, to, x, height: AXIS + ROW * (branches.length + 1) + 6 }
  }, [data, width])

  const statusLabel = (b: TimelineBranch) => t(b.status === 'merged' ? 'tlMerged' : b.status === 'stale' ? 'tlStale' : 'tlActive')
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
        <div className="tl-board">
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
              {ticks(layout.from, data.now).map((tk) => (
                <g key={tk}>
                  <line className="tl-grid" x1={layout.x(tk)} x2={layout.x(tk)} y1={AXIS - 6} y2={layout.height} />
                  <text className="tl-tick" x={layout.x(tk)} y={AXIS - 12} textAnchor="middle">{fmtDay.format(tk * 1000)}</text>
                </g>
              ))}
              <line className="tl-now" x1={layout.x(data.now)} x2={layout.x(data.now)} y1={AXIS - 6} y2={layout.height} />

              {/* base lane */}
              <line className="tl-base" x1={layout.x(layout.from)} x2={layout.x(data.now)} y1={yBase} y2={yBase} />
              {data.baseCommits.map((c) => (
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
                const r = 7
                return (
                  <g key={`${b.name}:${b.merge?.hash ?? 'tip'}`} className={`tl-branch is-${b.status}`} style={{ ['--c' as string]: color }}>
                    <title>{`${b.name} · ${statusLabel(b)} · ${t('tlCommits', { n: b.commits.length })}`}</title>
                    {forkVisible && <path className="tl-link" d={`M${xf},${yBase} V${y - r} Q${xf},${y} ${xf + r},${y} H${Math.max(xf + r, xs)}`} />}
                    <line className="tl-bar" x1={forkVisible ? xf + r : layout.x(layout.from)} x2={Math.max(xe, xs + 2)} y1={y} y2={y} />
                    {b.merge && (
                      <>
                        <path className="tl-link" d={`M${xe},${y} H${Math.max(xe, layout.x(b.merge.time) - r)} Q${layout.x(b.merge.time)},${y} ${layout.x(b.merge.time)},${y - r} V${yBase}`} />
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
                    {b.live && <circle className="tl-live" cx={xe} cy={y} r={6} />}
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
