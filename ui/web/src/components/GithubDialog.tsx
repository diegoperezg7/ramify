import { Check, Download, GitFork, Loader2, Lock, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bridge } from '../bridge'
import { relTime } from '../i18n'
import { useStore } from '../store'
import type { GithubRepo } from '../types'
import { BrandIcon } from './BrandIcon'
import { ListSkeleton } from './Skeletons'

export function GithubDialog() {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const settings = useStore((s) => s.settings)
  const busy = useStore((s) => s.busy)
  const setModal = useStore((s) => s.setModal)
  const addRepoPath = useStore((s) => s.addRepoPath)
  const cloneRepo = useStore((s) => s.cloneRepo)
  const ref = useRef<HTMLDialogElement>(null)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [cloning, setCloning] = useState<string | null>(null)

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true)
    try {
      setRepos(await bridge.github(refresh))
      setError(null)
    } catch (e) {
      const msg = (e as Error).message
      setError(msg === 'gh-missing' ? t('githubMissing') : msg === 'gh-auth' ? t('githubAuth') : msg)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    void load(false)
    const id = setInterval(() => void load(true), 60_000)
    return () => { clearInterval(id); d?.close() }
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (repos ?? []).filter((r) => !q || r.nameWithOwner.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
  }, [repos, query])
  const now = Math.floor(Date.now() / 1000)

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); setModal(null) }}>
      <div className="dialog-head">
        <h3>{t('githubTitle')}</h3>
        <div className="dialog-head-actions">
          <button type="button" className="icon-btn" onClick={() => load(true)} disabled={loading} aria-label={t('refresh')} title={t('refresh')}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setModal(null)} aria-label={t('close')}><X size={16} /></button>
        </div>
      </div>
      <label className="search">
        <Search size={15} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('githubSearch')} spellCheck={false} />
      </label>
      {settings && <p className="muted small">{t('githubCloneTo', { dir: settings.projectsDir })}</p>}
      <div className="gh-list">
        {error && <p className="gh-error">{error}</p>}
        {!error && repos === null && <ListSkeleton rows={6} />}
        {!error && repos !== null && filtered.length === 0 && <p className="muted small">{t('githubEmpty')}</p>}
        {filtered.map((r) => (
          <div key={r.nameWithOwner} className="gh-row">
            <div className="gh-main">
              <div className="gh-name">
                <span>{r.nameWithOwner.split('/')[1]}</span>
                {r.isPrivate && <span className="tag"><Lock size={11} />{t('privateRepo')}</span>}
                {r.isFork && <span className="tag"><GitFork size={11} />{t('fork')}</span>}
                {r.language && <span className="tag"><BrandIcon name={r.language} size={11} />{r.language}</span>}
              </div>
              {r.description && <p className="gh-desc">{r.description}</p>}
              <p className="gh-meta">{r.nameWithOwner.split('/')[0]} · {t('lastPush')} {relTime(lang, Math.floor(Date.parse(r.pushedAt) / 1000), now)}
                {r.local && <> · <span className="gh-local" title={r.local}>{t('githubLocal')}</span></>}
              </p>
            </div>
            <div className="gh-action">
              {r.added ? (
                <button type="button" className="btn btn-ghost" onClick={() => addRepoPath(r.local!)}><Check size={14} />{t('githubAdded')}</button>
              ) : r.local ? (
                <button type="button" className="btn btn-ghost" onClick={() => addRepoPath(r.local!)}><Plus size={14} />{t('githubAdd')}</button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={busy}
                  onClick={async () => { setCloning(r.nameWithOwner); if (await cloneRepo(r.nameWithOwner)) setModal(null); setCloning(null) }}>
                  {cloning === r.nameWithOwner ? <Loader2 size={14} className="spin" /> : <Download size={14} />}{t('githubClone')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </dialog>
  )
}
