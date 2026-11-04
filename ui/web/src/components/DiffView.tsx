import { useStore } from '../store'
import { DiffSkeleton } from './Skeletons'

type Row = { kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'; old: number | null; new: number | null; text: string }

/** Unified diff → rows with old and new line numbers, like GitHub's split gutter. */
export function parseDiff(diff: string): Row[] {
  const all = diff.replace(/\n$/, '').split('\n')
  const start = all.findIndex((l) => l.startsWith('@@'))
  const rows: Row[] = []
  let o = 0
  let n = 0
  for (const l of start === -1 ? all : all.slice(start)) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l)
    if (h) { o = Number(h[1]); n = Number(h[2]); rows.push({ kind: 'hunk', old: null, new: null, text: l }); continue }
    if (l.startsWith('\\')) rows.push({ kind: 'meta', old: null, new: null, text: l.slice(2) })
    else if (l.startsWith('+')) rows.push({ kind: 'add', old: null, new: n++, text: l.slice(1) })
    else if (l.startsWith('-')) rows.push({ kind: 'del', old: o++, new: null, text: l.slice(1) })
    else rows.push({ kind: 'ctx', old: o++, new: n++, text: l.slice(1) })
  }
  return rows
}

const SIGN = { add: '+', del: '−', ctx: ' ', hunk: '', meta: '' }

export function DiffView() {
  const diff = useStore((s) => s.diff)
  if (!diff) return <DiffSkeleton />
  return (
    <div className="diff" role="table">
      <div className="diff-rows">
        {parseDiff(diff).map((r, i) => (
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
