import { Check, Copy, ExternalLink, FolderOpen, GitMerge, Play, Trash2, X } from 'lucide-react'
import { BrandIcon } from './BrandIcon'
import { useState } from 'react'
import { agentVar } from '../agents'
import { bridge } from '../bridge'
import { relTime } from '../i18n'
import { friendlyMerge, mergeWords, prFor, prSignInHint, shellArg } from '../logic'
import { useStore } from '../store'
import { PrChip } from './PrChip'
import { Dialog } from './Dialog'
import { DiffStat, DiffView } from './DiffView'
import { AgentBadge } from './AgentBadge'
import { Activity } from './Activity'
import { upstreamLabel } from './WorktreeList'
import { Bar, ListSkeleton } from './Skeletons'
import { CommitDetail } from './CommitDetail'

export const IDE_LABELS: Record<string, string> = { xcode: 'Xcode', cursor: 'Cursor', code: 'VS Code', zed: 'Zed', idea: 'IntelliJ IDEA' }

export function Detail() {
  const state = useStore((s) => s.state)!
  const selected = useStore((s) => s.selected)
  const detail = useStore((s) => s.detail)
  const file = useStore((s) => s.file)
  const openFile = useStore((s) => s.openFile)
  const select = useStore((s) => s.select)
  const setMergeDone = useStore((s) => s.setMergeDone)
  const run = useStore((s) => s.run)
  const busy = useStore((s) => s.busy)
  const lang = useStore((s) => s.lang)
  const t = useStore((s) => s.t)
  const repo = useStore((s) => s.repo)
  const caps = useStore((s) => s.caps)
  const settings = useStore((s) => s.settings)
  const [tab, setTab] = useState<'files' | 'commits'>('files')
  const [dialog, setDialog] = useState<'merge' | 'remove' | null>(null)
  const [force, setForce] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const prs = useStore((s) => s.prs)
  const signInGithub = useStore((s) => s.signInGithub)
  const github = useStore((s) => s.repos.find((r) => r.path === s.repo)?.github ?? null)
  // Signed in, pull requests are read with the account even without gh; signed out, the detail says so.
  const account = useStore((s) => s.github)

  const commit = useStore((s) => s.commit)
  if (commit) return <CommitDetail hash={commit} />
  const w = state.worktrees.find((x) => x.path === selected)
  if (!w) {
    return (
      <section className="pane detail-pane placeholder">
        <span className="pane-kicker">{t('inspector')}</span>
        <Activity />
      </section>
    )
  }

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500) } catch { /* denied */ }
  }
  // Pasted into a terminal: a branch made outside the app can hold ; $ ` and the like, so it is quoted.
  const command = `ramify open ${shellArg(w.branch)}${w.agent ? ` -a ${shellArg(w.agent)}` : ''}`
  const mergeBlocked = w.changes > 0 ? t('whyNoMergeChanges') : w.commits === 0 ? t('whyNoMergeCommits') : null
  // Shown next to the merge button: with an open pull request, the merge happens on GitHub (squashed).
  const pr = w.main ? undefined : prFor(prs, w.branch)
  const signInHint = !w.main && !pr && prSignInHint(account, github)

  return (
    <section className="pane detail-pane" style={{ ['--c' as string]: w.main ? 'var(--lane-main)' : agentVar(w.agent) }}>
      <header className="detail-head">
        <div className="detail-title">
          <span className="agent-chip">{w.main ? <span className="dot" /> : <AgentBadge agent={w.agent} size={20} live={w.running.length > 0} />}{w.main ? t('mainCheckout') : w.agent || t('noAgent')}{w.running.length > 0 && <span className="chip-live">{t('running')}</span>}</span>
          <h2 className="branch">{w.branch}</h2>
          <button type="button" className="path" onClick={() => copy('path', w.path)} title={t('copyPath')}>
            {copied === 'path' ? <Check size={13} /> : <Copy size={13} />}<span>{w.path}</span>
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={() => select(null)} aria-label={t('close')}><X size={18} /></button>
      </header>

      <dl className="facts">
        <div><dt>{t('changes')}</dt><dd className={w.changes ? 'warn' : ''}>{w.changes}</dd></div>
        {!w.main && <div><dt>{t('commits')}</dt><dd>{w.commits}</dd></div>}
        <div><dt>{t('upstream')}</dt><dd>{upstreamLabel(w, t)}</dd></div>
        {pr && <div className="fact-pr"><dt>{t('pr')}</dt><dd><PrChip pr={pr} /></dd></div>}
        {w.port && (
          <div><dt>{t('ports')}</dt><dd>
            <a href={`http://localhost:${w.port}`} target="_blank" rel="noreferrer">{w.port}–{w.port + 9}<ExternalLink size={12} /></a>
          </dd></div>
        )}
      </dl>
      {signInHint && (
        <p className="pr-hint">
          {t('prSignIn')} <button type="button" className="pr-hint-btn" onClick={signInGithub}>{t('obGhSignIn')}</button>
        </p>
      )}

      <div className="actions">
        <div className="ide-row" role="group" aria-label={t('openIn')}>
          <span className="muted small">{t('openIn')}</span>
          {/* Only the editors installed here; the first is the default one (Settings). */}
          {(caps?.ides ?? []).filter((id) => id !== 'Finder').map((id, i) => (
            <button key={id} type="button" className={`btn ${i === 0 ? 'btn-ide-main' : 'btn-ghost'}`} disabled={busy}
              onClick={() => run(() => bridge.open(repo, w.path, id))}><BrandIcon name={IDE_LABELS[id] ?? id} size={14} />{IDE_LABELS[id] ?? id}</button>
          ))}
          {caps?.ides.includes('Finder') && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => bridge.open(repo, w.path, 'Finder'))}>
              <FolderOpen size={14} />{caps.platform === 'win32' ? t('explorer') : 'Finder'}
            </button>
          )}
        </div>
        <div className="main-actions">
          {caps?.create && !w.main && (
            <button type="button" className="btn btn-ghost" disabled={busy}
              onClick={() => run(() => bridge.launch(repo, w.path, w.agent || settings?.defaultAgent || 'claude'))}>
              <Play size={14} />{t('launchAgent')}{w.agent ? ` · ${w.agent}` : ''}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => copy('cmd', command)}>
            {copied === 'cmd' ? <Check size={14} /> : <Copy size={14} />}{copied === 'cmd' ? t('copied') : t('copyCmd')}
          </button>
          {!w.main && (
            <>
              <button type="button" className="btn btn-primary" disabled={busy || !!mergeBlocked}
                title={mergeBlocked ?? undefined} onClick={() => setDialog('merge')}>
                <GitMerge size={14} />{t('merge')} {state.base}
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { setForce(false); setDialog('remove') }}>
                <Trash2 size={14} />{t('remove')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
          {t('files')} <span className="count">{detail ? detail.files.length : <Bar w={10} h={9} />}</span>
        </button>
        {!w.main && (
          <button type="button" role="tab" aria-selected={tab === 'commits'} onClick={() => setTab('commits')}>
            {t('commits')} <span className="count">{detail ? detail.commits.length : <Bar w={10} h={9} />}</span>
          </button>
        )}
      </div>

      <div className="tab-body">
        {!detail && <ListSkeleton rows={5} />}
        {tab === 'files' && detail && (
          detail.files.length === 0 ? <p className="muted small">{t('noFiles')}</p> : (
            <ul className="files">
              {detail.files.map((f) => (
                <li key={f.file}>
                  <button type="button" className={`file${file === f.file ? ' is-open' : ''}`} onClick={() => openFile(file === f.file ? null : f.file)}>
                    <span className={`st st-${f.status === '?' ? 'A' : f.status}`}>{f.status === '?' ? 'A' : f.status}</span>
                    <span className="fname">{f.file}</span>
                    {f.uncommitted && <span className="pending">{t('pending')}</span>}
                    {(f.add || f.del) && <span className="numstat"><ins>+{f.add}</ins><del>−{f.del}</del>
                      {f.add !== '-' && <DiffStat add={Number(f.add) || 0} del={Number(f.del) || 0} />}</span>}
                  </button>
                  {file === f.file && <DiffView />}
                </li>
              ))}
            </ul>
          )
        )}
        {tab === 'commits' && detail && (
          detail.commits.length === 0 ? <p className="muted small">{t('noCommits')} {state.base}.</p> : (
            <ul className="commits">
              {detail.commits.map((c) => (
                <li key={c.hash}>
                  <span className="node" />
                  <span className="subject">{c.subject}</span>
                  <span className="meta">{relTime(lang, c.time, state.now)} <code>{c.hash.slice(0, 7)}</code></span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {dialog === 'merge' && (
        <Dialog title={t('mergeTitle')} confirmLabel={`${t('merge')} ${state.base}`}
          onCancel={() => setDialog(null)}
          onConfirm={async () => { setDialog(null); await run(() => friendlyMerge(() => bridge.merge(repo, w.path), { branch: w.branch, base: state.base, path: w.path }, t('mergedOk', { branch: w.branch, base: state.base }), t('mergedRebuilt', { branch: w.branch, base: state.base }), mergeWords(t, w.branch, state.base))
            .then((r) => { setMergeDone({ branch: w.branch, base: state.base, rebuilt: r.rebuilt }); return r })) }}>
          <p>{t('mergeText', { branch: w.branch, base: state.base })}</p>
        </Dialog>
      )}
      {dialog === 'remove' && (
        <Dialog title={t('removeTitle')} confirmLabel={t('remove')} danger
          onCancel={() => setDialog(null)}
          onConfirm={async () => { setDialog(null); if (await run(() => bridge.remove(repo, w.path, force))) select(null) }}>
          <p>{t('removeText', { path: w.path, branch: w.branch })}</p>
          <label className="check"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{t('force')}</label>
        </Dialog>
      )}
    </section>
  )
}
