import type { CSSProperties } from 'react'
import { useStore } from '../store'

// Loading placeholders shaped like the real screens, so nothing jumps when the data arrives.
// Titles stay real text; only the data is drawn as grey bars. Screen readers hear one "loading".

/** One grey bar. Width in px (or any CSS length), height defaults to a text line. */
export function Bar({ w, h, r, style }: { w: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <i className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

/** Widths that vary row to row but stay the same on every render. */
const vary = (i: number, base: number, spread: number) => base + ((i * 37) % spread)

/** Rows of a list: an optional square (icon or badge), a title line and a sub line. */
export function ListSkeleton({ rows, icon = true, className = 'skel-list' }: { rows: number; icon?: boolean; className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel-row">
          {icon && <Bar w={18} h={18} r={5} />}
          <span className="skel-lines"><Bar w={vary(i, 110, 90)} /><Bar w={vary(i, 70, 60)} h={10} /></span>
        </div>
      ))}
    </div>
  )
}

/** The repository view: worktree list, branch tree and inspector. */
export function RepoSkeleton() {
  const t = useStore((s) => s.t)
  return (
    <main className="layout" role="status" aria-label={t('loadingRepo')} aria-busy="true">
      <section className="pane list-pane" aria-hidden="true">
        <header className="pane-head"><h2>{t('worktrees')}</h2></header>
        <ListSkeleton rows={4} icon={false} className="skel-list skel-wt" />
      </section>
      <section className="pane graph-pane" aria-hidden="true">
        <header className="pane-head"><h2>{t('branchTree')}</h2></header>
        <div className="skel-graph">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skel-graph-row">
              <span className="skel-lane" style={{ paddingLeft: i % 5 === 2 || i % 5 === 3 ? 26 : 0 }}><Bar w={12} h={12} r={6} /></span>
              <Bar w={vary(i, 140, 220)} />
              <span className="skel-push"><Bar w={70} h={10} /><Bar w={52} h={10} /></span>
            </div>
          ))}
        </div>
      </section>
      <section className="pane detail-pane placeholder" aria-hidden="true">
        <span className="pane-kicker">{t('inspector')}</span>
        <ListSkeleton rows={5} />
      </section>
    </main>
  )
}

/** The branch timeline board: labels on the left, one band per branch on the right. */
export function TimelineSkeleton() {
  const t = useStore((s) => s.t)
  const bands = [[4, 96], [62, 34], [70, 22], [48, 30], [12, 18]]
  return (
    <div className="tl-board skel-tl" role="status" aria-label={t('loadingRepo')} aria-busy="true">
      <div className="skel-tl-labels" aria-hidden="true">
        {bands.map((_, i) => (
          <div key={i} className="skel-row"><Bar w={18} h={18} r={5} /><Bar w={vary(i, 90, 60)} /><span className="skel-push"><Bar w={46} h={14} r={4} /></span></div>
        ))}
      </div>
      <div className="skel-tl-plot" aria-hidden="true">
        {bands.map(([left, width], i) => (
          <div key={i} className="skel-tl-band"><Bar w={`${width}%`} h={i === 0 ? 6 : 10} style={{ marginLeft: `${left}%` }} /></div>
        ))}
      </div>
    </div>
  )
}

/** AI sessions: two columns of repository cards. */
export function SessionsSkeleton() {
  const t = useStore((s) => s.t)
  return (
    <div className="repo-cards" role="status" aria-label={t('loadingRepo')} aria-busy="true">
      {[[2, 1], [3]].map((col, c) => (
        <div key={c} className="repo-col" aria-hidden="true">
          {col.map((rows, i) => (
            <section key={i} className="repo-card cc-skel">
              <header><Bar w={15} h={15} /><Bar w={vary(c + i, 80, 50)} /></header>
              <ListSkeleton rows={rows} />
            </section>
          ))}
        </div>
      ))}
    </div>
  )
}

/** A diff while it loads: numbered lines of varying length. */
export function DiffSkeleton() {
  return (
    <div className="diff skel-diff" aria-busy="true" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="skel-row"><Bar w={22} h={10} /><Bar w={`${vary(i, 25, 55)}%`} h={10} /></div>
      ))}
    </div>
  )
}
