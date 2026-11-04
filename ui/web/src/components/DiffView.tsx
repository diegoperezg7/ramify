import { useStore } from '../store'

export function DiffView() {
  const diff = useStore((s) => s.diff)
  if (!diff) return <div className="diff is-loading" />
  const all = diff.replace(/\n$/, '').split('\n')
  const start = all.findIndex((l) => l.startsWith('@@'))
  const lines = start === -1 ? all : all.slice(start)
  return (
    <pre className="diff">
      {lines.map((l, i) => {
        const kind = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''
        return <span key={i} className={kind}>{l || ' '}{'\n'}</span>
      })}
    </pre>
  )
}
