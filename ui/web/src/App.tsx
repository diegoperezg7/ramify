import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useEffect } from 'react'
import { Detail } from './components/Detail'
import { Graph } from './components/Graph'
import { Stats } from './components/Stats'
import { TopBar } from './components/TopBar'
import { WorktreeList } from './components/WorktreeList'
import { useStore } from './store'

const POLL_MS = 2500

export function App() {
  const state = useStore((s) => s.state)
  const conn = useStore((s) => s.conn)
  const theme = useStore((s) => s.theme)
  const lang = useStore((s) => s.lang)
  const toasts = useStore((s) => s.toasts)
  const poll = useStore((s) => s.poll)
  const t = useStore((s) => s.t)

  useEffect(() => {
    void poll()
    const id = setInterval(() => { if (!document.hidden) void poll() }, POLL_MS)
    return () => clearInterval(id)
  }, [poll])

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  return (
    <div className="app">
      <TopBar />
      {conn !== 'ok' && (
        <div className="banner" role="alert"><AlertTriangle size={16} />{conn === 'unauthorized' ? t('badToken') : t('offline')}</div>
      )}
      {state && (
        <>
          <Stats />
          <main className="layout">
            <WorktreeList />
            <Graph />
            <Detail />
          </main>
        </>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`}>
            {x.kind === 'ok' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
