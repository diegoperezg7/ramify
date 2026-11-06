import { Check, Copy, ExternalLink, KeyRound, Loader2, Lock, LogOut, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bridge } from '../bridge'
import { useStore } from '../store'
import { GithubIcon } from './GithubIcon'

/**
 * The GitHub account in Settings: who is signed in, sign in (the same device flow as the introduction),
 * sign out, and the page where the user picks which repositories Ramify can see.
 */
export function GithubAccountPanel() {
  const t = useStore((s) => s.t)
  const account = useStore((s) => s.github)
  const refreshGithub = useStore((s) => s.refreshGithub)
  const [code, setCode] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)

  useEffect(() => { void refreshGithub() }, [refreshGithub])
  useEffect(() => { pending.current = code !== null }, [code])
  // Closing Settings (or leaving this section) stops a sign-in still waiting for approval on github.com.
  useEffect(() => () => { if (pending.current) void bridge.githubCancel().catch(() => {}) }, [])

  // While waiting for the user to approve on github.com, ask the app (not GitHub) every 2 s.
  useEffect(() => {
    if (!code) return
    const id = setInterval(async () => {
      await refreshGithub()
      const a = useStore.getState().github
      if (a?.status === 'signed-in') setCode(null)
      if (a?.status === 'error') { setCode(null); setError(a.error ?? 'error') }
    }, 2000)
    return () => clearInterval(id)
  }, [code, refreshGithub])

  const start = async () => {
    setError(null)
    setCopied(false)
    try { setCode(await bridge.githubSignIn()) } catch (e) { setError((e as Error).message) }
  }
  const cancel = async () => {
    try { await bridge.githubCancel() } catch { /* the host stops it on its own when the code expires */ } finally { setCode(null); void refreshGithub() }
  }
  const signOut = async () => {
    setBusy(true)
    try { await bridge.githubSignOut() } catch (e) { setError((e as Error).message) } finally { setBusy(false); void refreshGithub() }
  }

  if (!account) return <p className="muted small"><Loader2 size={14} className="spin" /> {t('loading')}</p>

  return (
    <div className="gh-account">
      {!account.configured && <p className="ob-note">{t('obGhNotConfigured')}</p>}

      {account.configured && account.status === 'signed-in' && account.user && (
        <>
          <div className="gh-user">
            <img src={account.user.avatarUrl} alt="" width={40} height={40} />
            <div>
              <span className="muted small">{t('ghSignedInAs')}</span>
              <b>{account.user.name ?? account.user.login}</b>
              <span className="muted small">@{account.user.login}</span>
            </div>
          </div>
          <div className="gh-actions">
            {account.installUrl && (
              <a className="btn btn-ghost" href={account.installUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />{t('ghPickRepos')}</a>
            )}
            <button type="button" className="btn btn-ghost" onClick={signOut} disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <LogOut size={14} />}{t('ghSignOut')}
            </button>
          </div>
        </>
      )}

      {account.configured && account.status !== 'signed-in' && !code && (
        <>
          <p className="muted">{t('obGhText')}</p>
          <div className="gh-actions">
            <button type="button" className="btn btn-primary" onClick={start}><GithubIcon size={15} />{t('obGhSignIn')}</button>
          </div>
        </>
      )}

      {code && (
        <div className="ob-code">
          <p className="small muted">{t('obGhEnterCode')}</p>
          <div className="ob-code-digits" aria-label={code.userCode}>
            {code.userCode.split('').map((c, i) => <span key={i} className={c === '-' ? 'dash' : ''}>{c}</span>)}
          </div>
          <div className="ob-code-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { void navigator.clipboard.writeText(code.userCode).catch(() => {}); setCopied(true) }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t('copied') : t('obGhCopy')}
            </button>
            <a className="btn btn-ghost" href={code.verificationUri} target="_blank" rel="noreferrer"><ExternalLink size={14} />{t('obGhOpen')}</a>
            <button type="button" className="btn btn-ghost" onClick={cancel}>{t('cancel')}</button>
          </div>
          <p className="ob-waiting"><Loader2 size={14} className="spin" />{t('obGhWaiting')}</p>
        </div>
      )}

      {error && <p className="ob-note is-error">{t(error === 'denied' ? 'obGhDenied' : error === 'expired' ? 'obGhExpired' : 'obGhFailed')}</p>}

      <ul className="ob-security">
        <li><ShieldCheck size={14} />{t('obSec1')}</li>
        <li><KeyRound size={14} />{account.keychain === false ? t('obSec2Session') : t('obSec2')}</li>
        <li><Lock size={14} />{t('obSec3')}</li>
      </ul>
    </div>
  )
}
