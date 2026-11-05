import type { CSSProperties } from 'react'
import { parseDiff } from '../logic'
import { useStore } from '../store'
import { DiffSkeleton } from './Skeletons'

/** The engine cuts a diff at this many characters (MAX_DIFF in packages/core/src/engine.ts). */
const MAX_DIFF = 400_000

const SIGN = { add: '+', del: '−', ctx: ' ', hunk: '', meta: '' }

/** A diff: the open worktree file's from the store, or the one passed in (a commit's file). */
export function DiffView({ diff: given }: { diff?: string | null } = {}) {
  const stored = useStore((s) => s.diff)
  const diff = given === undefined ? stored : given
  const t = useStore((s) => s.t)
  // null: still loading. '' or no rows: git has no text to show (binary file, new folder, permissions only).
  if (diff === null) return <DiffSkeleton />
  const rows = parseDiff(diff)
  if (!rows.length) return <p className="diff diff-empty muted small">{t('diffNone')}</p>
  if (diff.length >= MAX_DIFF) rows.push({ kind: 'meta', old: null, new: null, text: t('diffTruncated') })
  // The number columns fit the longest line number, so files past line 9999 stay readable.
  const digits = String(rows.reduce((m, r) => Math.max(m, r.old ?? 0, r.new ?? 0), 0)).length
  return (
    <div className="diff" role="table">
      <div className="diff-rows" style={{ '--ln-digits': `${digits}ch` } as CSSProperties}>
        {rows.map((r, i) => (
          <div key={i} className={`dl dl-${r.kind}`} role="row">
            <span className="ln" role="cell">{r.old ?? ''}</span>
            <span className="ln" role="cell">{r.new ?? ''}</span>
            <span className="sg" role="cell" aria-hidden="true">{SIGN[r.kind]}</span>
            <span className="code" role="cell">{r.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** GitHub's five-square summary of added (green) and removed (red) lines. */
export function DiffStat({ add, del }: { add: number; del: number }) {
  const total = add + del
  const green = total ? Math.round((add / total) * 5) : 0
  const red = total ? Math.min(5 - green, Math.round((del / total) * 5)) : 0
  return (
    <span className="diffstat" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < green ? 'is-add' : i < green + red ? 'is-del' : ''} />)}
    </span>
  )
}
