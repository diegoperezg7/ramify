import { Check, Copy, GitBranch, GitCommitHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { agentVar } from '../agents'
import { bridge } from '../bridge'
import { relTime } from '../i18n'
import { useStore } from '../store'
import type { CommitDetail as Commit } from '../types'
import { DiffStat, DiffView } from './DiffView'
import { ListSkeleton } from './Skeletons'

/** A commit picked in the graph: what it says, the files it changed with their diffs, and where it comes from. */
export function CommitDetail({ hash }: { hash: string }) {
  const state = useStore((s) => s.state)!
  const repo = useStore((s) => s.repo)
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const selectCommit = useStore((s) => s.selectCommit)
  const select = useStore((s) => s.select)
  const toast = useStore((s) => s.toast)
  const [c, setC] = useState<Commit | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    setC(null); setFile(null); setDiff(null)
    bridge.commit(repo, hash).then((x) => { if (alive) setC(x) }, (e: Error) => { if (alive) { toast('error', e.message); selectCommit(null) } })
    return () => { alive = false }
  }, [repo, hash, toast, selectCommit])

  const open = (f: string) => {
    if (file === f) { setFile(null); return }
    setFile(f); setDiff(null)
    bridge.commitDiff(repo, hash, f).then(
      (r) => setDiff((cur) => (cur === null ? r.diff : cur)),
      (e: Error) => { setDiff(''); toast('error', e.message) })
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(hash); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* denied */ }
  }

  // What the graph already knows about it: the branch it belongs to, and the subjects of its parents.
  const row = state.commits.find((x) => x.hash === hash)
  const owner = row?.owner ?? null
  const wt = owner ? state.worktrees.find((w) => w.branch === owner) : undefined
  const color = owner ? (wt ? agentVar(wt.agent) : 'var(--lane-branch)') : 'var(--lane-base)'
  const subjectOf = (p: string) => state.commits.find((x) => x.hash === p)?.subject

  return (
    <section className="pane detail-pane commit-pane" style={{ ['--c' as string]: color }} aria-label={t('commitKicker')}>
      <header className="detail-head">
        <div className="detail-title">
          <span className="agent-chip"><GitCommitHorizontal size={15} />{t('commitKicker')}
            <button type="button" className="commit-hash" onClick={copy} title={hash}>
              <code>{hash.slice(0, 7)}</code>{copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </span>
          <h2 className="branch commit-subject">{c?.subject ?? row?.subject ?? ''}</h2>
          {c && <p className="muted small">{c.author} · <time title={new Date(c.time * 1000).toLocaleString(lang)}>{relTime(lang, c.time, state.now)}</time></p>}
        </div>
        <button type="button" className="icon-btn" onClick={() => selectCommit(null)} aria-label={t('close')}><X size={15} /></button>
      </header>

      {c?.body && <p className="commit-body">{c.body}</p>}

      <div className="commit-links">
        {owner && (
          wt ? <button type="button" className="ref ref-branch" style={{ ['--c' as string]: color }} onClick={() => select(wt.path)} title={t('commitOpenBranch')}><GitBranch size={11} />{owner}</button>
            : <span className="ref ref-branch" style={{ ['--c' as string]: color }}><GitBranch size={11} />{owner}</span>
        )}
        {c && (c.parents.length === 0 ? <span className="muted small">{t('commitFirst')}</span> : (
          <span className="commit-parents">
            <span className="muted small">{t('commitParents')}</span>
            {c.parents.map((p) => (
              <button key={p} type="button" className="commit-parent" onClick={() => selectCommit(p)} title={subjectOf(p) ?? p}>
                <code>{p.slice(0, 7)}</code>{subjectOf(p) && <span>{subjectOf(p)}</span>}
              </button>
            ))}
          </span>
        ))}
      </div>
      {c && c.parents.length > 1 && <p className="muted small commit-note">{t('commitMergeNote')}</p>}

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected>{t('files')} <span className="count">{c ? c.files.length : '…'}</span></button>
      </div>
      <div className="tab-body">
        {!c ? <ListSkeleton rows={4} /> : c.files.length === 0 ? <p className="muted small">{t('noFiles')}</p> : (
          <ul className="files">
            {c.files.map((f) => (
              <li key={f.file}>
                <button type="button" className={`file${file === f.file ? ' is-open' : ''}`} onClick={() => open(f.file)}>
                  <span className={`st st-${f.status}`}>{f.status}</span>
                  <span className="fname">{f.file}</span>
                  {(f.add || f.del) && <span className="numstat"><ins>+{f.add}</ins><del>−{f.del}</del>
                    {f.add !== '-' && <DiffStat add={Number(f.add) || 0} del={Number(f.del) || 0} />}</span>}
                </button>
                {file === f.file && <DiffView diff={diff} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
