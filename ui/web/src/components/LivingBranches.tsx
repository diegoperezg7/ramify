import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { agentVar } from '../agents'
import { useStore } from '../store'

/**
 * A small branch tree in each side margin, drawn like the app's own graph: a base lane, branches that fork off it
 * with the same S-curve, commits ringed in the background colour, hollow merge commits and a pulsing live tip.
 *
 * - The base lane comes along the strip under the status bar, turns the bottom corner and runs up the margin.
 * - Under the top bar, two finished branches (forked and merged back), in the logo's colours, are always there.
 * - Every agent working forks one more branch off the base lane, from the bottom up, in its colour: it draws itself
 *   in when the agent starts, its tip pulses while it works, and it folds back when the agent stops.
 *
 * Pure decoration: aria-hidden, never clickable, behind the opaque panes, so it only shows in the window's padding.
 * At most three branches per side (MAX_SLOTS in all): past that the margin reads as noise, and the exact count is
 * already in the top bar. With reduced motion nothing animates.
 */
const MAX_SLOTS = 6
const FORK = 24 // height of the S-curve between the base lane and a branch
const COMMIT = 30 // distance between commits on a branch

type Geo = { W: number; H: number; xm: number; xb: number; y0: number; top: number; hl: number }

const curveUp = (x1: number, y1: number, x2: number) => `C${x1} ${y1 - FORK * 0.55} ${x2} ${y1 - FORK * 0.45} ${x2} ${y1 - FORK}`

export function LivingBranches() {
  const multiRepo = useStore((s) => s.caps?.multiRepo)
  const repos = useStore((s) => s.repos)
  const state = useStore((s) => s.state)

  // Every agent working: across all repositories in the desktop app, in the open one elsewhere.
  const agents = useMemo(
    () => (multiRepo ? repos.flatMap((r) => r.active ?? []) : (state?.worktrees ?? []).flatMap((w) => w.running)).slice(0, MAX_SLOTS),
    [multiRepo, repos, state],
  )

  // The margins only change with the window: measured on resize, never per frame.
  const ref = useRef<SVGSVGElement>(null)
  const [geo, setGeo] = useState<Geo | null>(null)
  useEffect(() => {
    const app = ref.current?.closest<HTMLElement>('.app')
    if (!app) return
    const measure = () => {
      const cs = getComputedStyle(app)
      const W = app.clientWidth, H = app.clientHeight
      const padX = parseFloat(cs.paddingLeft) || 0
      const gap = parseFloat(cs.paddingBottom) || 12
      const bar = app.querySelector('.topbar')
      const top = bar ? bar.getBoundingClientRect().bottom - app.getBoundingClientRect().top + 4 : 60
      const c0 = Math.max(0, padX - 26)
      setGeo({ W, H, xm: c0 + 6, xb: c0 + 17, y0: H - gap / 2, top, hl: Math.min(320, W * 0.22) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(app)
    return () => ro.disconnect()
  }, [])

  // A slot keeps its last colour while it folds back, so a branch never changes colour on its way out.
  const colors = useRef<string[]>([])
  agents.forEach((a, i) => { colors.current[i] = agentVar(a) })

  if (!geo) return <svg ref={ref} className="living-branches" aria-hidden="true" />
  const { W, H, xm, xb, y0, top, hl } = geo
  const R = 10

  // Agent branches stack from the bottom up, under the finished ones at the top.
  const low = y0 - R - 34, high = top + 330
  const span = Math.min(170, (low - high) / 3)
  const perSide = span >= 80 ? 3 : Math.max(0, Math.floor((low - high) / 80))
  const slots = Array.from({ length: Math.min(MAX_SLOTS, perSide * 2) }, (_, i) => {
    const k = Math.floor(i / 2)
    const yF = low - k * span
    const yT = yF - (perSide === 3 ? span : 80) + 36
    const commits: number[] = []
    for (let y = yF - FORK - COMMIT * 0.6; y > yT + 14; y -= COMMIT) commits.push(y)
    return { side: i % 2 ? 'r' : 'l', yF, yT, commits, d: `M${xm} ${yF} ${curveUp(xm, yF, xb)} V${yT}` }
  })

  // The finished branches under the top bar: fork, a few commits, merge back into the base lane.
  const done = [
    { color: '#fb923c', yF: top + 150, yM: top + 46 },
    { color: '#38bdf8', yF: top + 290, yM: top + 186 },
  ].map((b) => ({ ...b, d: `M${xm} ${b.yF} ${curveUp(xm, b.yF, xb)} V${b.yM + FORK} C${xb} ${b.yM + FORK * 0.45} ${xm} ${b.yM + FORK * 0.55} ${xm} ${b.yM}`, commits: [b.yF - FORK - 18, b.yF - FORK - 48] }))

  // Commits on the base lane: where every branch forks, and a few along the bottom strip.
  const baseY = [...done.map((b) => b.yF), ...slots.map((s) => s.yF)]
  const baseX = [70, 150, 230].filter((x) => x < hl * 0.85)

  const side = (s: 'l' | 'r') => (
    <g key={s} transform={s === 'r' ? `translate(${W} 0) scale(-1 1)` : undefined}>
      <path className="lb-base" d={`M${xm} ${y0 - R} V${top}`} stroke="url(#lb-up)" />
      <path className="lb-base" d={`M${xm + hl} ${y0} H${xm + R} Q${xm} ${y0} ${xm} ${y0 - R}`} stroke="url(#lb-along)" />
      {done.map((b) => (
        <g key={b.yF} style={{ ['--c' as string]: b.color }}>
          <path className="lb-edge" d={b.d} />
          {b.commits.map((y) => <circle key={y} className="lb-commit" cx={xb} cy={y} r={3.6} />)}
          <circle className="lb-merge" cx={xm} cy={b.yM} r={2.8} />
        </g>
      ))}
      {baseY.map((y) => <circle key={y} className="lb-commit is-base" cx={xm} cy={y} r={3.2} />)}
      {baseX.map((x) => <circle key={x} className="lb-commit is-base" cx={xm + x} cy={y0} r={3.2} style={{ opacity: 1 - x / hl }} />)}
      {slots.map((sl, i) => sl.side !== s ? null : (
        <g key={i} className={`lb-slot${i < agents.length ? ' is-on' : ''}`} style={{ ['--c' as string]: colors.current[i] ?? 'transparent' }}>
          <path className="lb-edge" d={sl.d} pathLength={1} />
          {sl.commits.map((y, j) => <circle key={y} className="lb-commit" cx={xb} cy={y} r={3.6} style={{ ['--d' as string]: `${0.35 + j * 0.12}s` } as CSSProperties} />)}
          <circle className="lb-live" cx={xb} cy={sl.yT} r={4.2} />
          <circle className="lb-tip" cx={xb} cy={sl.yT} r={4.2} />
        </g>
      ))}
    </g>
  )

  return (
    <svg ref={ref} className="living-branches" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="lb-up" gradientUnits="userSpaceOnUse" x1="0" y1={y0} x2="0" y2={top}>
          <stop offset="0" className="lb-stop" /><stop offset="0.85" className="lb-stop" /><stop offset="1" className="lb-stop is-clear" />
        </linearGradient>
        <linearGradient id="lb-along" gradientUnits="userSpaceOnUse" x1={xm} y1="0" x2={xm + hl} y2="0">
          <stop offset="0" className="lb-stop" /><stop offset="0.45" className="lb-stop" /><stop offset="1" className="lb-stop is-clear" />
        </linearGradient>
      </defs>
      {side('l')}
      {side('r')}
    </svg>
  )
}
