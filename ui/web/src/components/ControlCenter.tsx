import { AlertTriangle, ArrowDownToLine, BookOpen, Check, ExternalLink, FolderGit2, GitMerge, GitPullRequest, Loader2, MoreHorizontal, Play, Plus, SquareTerminal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { bridge } from '../bridge'
import { useStore } from '../store'
import type { AgentSession, BranchHealth, Health, PullRequest } from '../types'
import { AgentBadge } from './AgentBadge'
import { Dialog } from './Dialog'
import { GithubIcon } from './GithubIcon'
import { Heatmap } from './Heatmap'
import { nextAction, type Action } from '../logic'

/** Pull requests of ~400 changed lines or more are hard to review: say so. */
const BIG = 400

type Board = { repo: string; name: string; github: string | null; health: Health; prs: PullRequest[] }

export function ControlCenter() {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const repos = useStore((s) => s.repos)
  const sessions = useStore((s) => s.sessions)
  const setModal = useStore((s) => s.setModal)
  const setRepo = useStore((s) => s.setRepo)
  const setView = useStore((s) => s.setView)
  const select = useStore((s) => s.select)
  const toast = useStore((s) => s.toast)
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [days, setDays] = useState<Record<number, number>>({})
  const [shell, setShell] = useState<{ installed: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ action: Action; board: Board; b: BranchHealth } | null>(null)
  const prsAt = useRef(new Map<string, { at: number; prs: PullRequest[] }>())

  // Repositories with something being built: worktrees, or agents working right now.
  const building = useMemo(() => repos.filter((r) => r.worktrees > 0 || r.active?.length), [repos])

  const load = useCallback(async () => {
    const out: Board[] = []
    for (const r of building) {
      try {
        const health = await bridge.health(r.path)
        let cached = prsAt.current.get(r.path)
        if (!cached || Date.now() - cached.at > 60_000) {
          cached = { at: Date.now(), prs: r.github ? await bridge.pullRequests(r.path).catch(() => []) : [] }
          prsAt.current.set(r.path, cached)
        }
        if (health.branches.length) out.push({ repo: r.path, name: r.name, github: r.github ?? null, health, prs: cached.prs })
      } catch { /* unreadable repository: skip it */ }
    }
    setBoards(out)
  }, [building])

  useEffect(() => {
    let alive = true
    let running = false
    const tick = async () => { if (running || !alive) return; running = true; try { await load() } finally { running = false } }
    void tick()
    const id = setInterval(() => { if (!document.hidden) void tick() }, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [load])

  useEffect(() => {
    void bridge.shellIntegration().then(setShell).catch(() => setShell(null))
    void (async () => {
      const merged: Record<number, number> = {}
      for (const r of repos) {
        try { for (const [d, n] of Object.entries(await bridge.commitDays(r.path, 182))) merged[Number(d)] = (merged[Number(d)] ?? 0) + n } catch { /* skip */ }
      }
      setDays(merged)
    })()
  }, [repos])

  const sessionsOf = (repo: string, branch: string) =>
    (sessions ?? []).filter((s) => s.end === null && !s.inferred && s.repo === repo && s.branch === branch)
  const stateOf = (list: AgentSession[]) => (list.some((s) => s.state === 'waiting') ? 'waiting' : list.some((s) => s.state === 'working' || !s.state) ? 'working' : list.length ? 'idle' : null)

  const run = async (key: string, fn: () => Promise<{ message: string }>) => {
    setBusy(key)
    try { const { message } = await fn(); toast('ok', message); prsAt.current.clear(); await load() } catch (e) { toast('error', (e as Error).message) } finally { setBusy(null) }
  }

  const act = (action: Action, board: Board, b: BranchHealth, pr?: PullRequest) => {
    const key = `${board.repo}#${b.branch}`
    if (action === 'open') { setRepo(board.repo); select(b.path); return }
    if (action === 'view-pr' && pr) { window.open(pr.url, '_blank'); return }
    if (action === 'launch') { void run(key, () => bridge.launch(board.repo, b.path, b.agent || b.running[0] || 'claude')); return }
    if (action === 'update') { void run(key, () => bridge.updateFromBase(board.repo, b.path)); return }
    setConfirm({ action, board, b })
  }

  const totals = useMemo(() => {
    const all = (boards ?? []).flatMap((x) => x.health.branches.filter((b) => !b.main))
    return { branches: all.length, working: all.filter((b) => b.running.length).length, attention: all.filter((b) => b.overlaps.length || b.behind >= 20).length }
  }, [boards])

  return (
    <main className="sessions control">
      <header className="sessions-head">
        <div>
          <h1>{t('controlTitle')}</h1>
          <p className="muted small">{t('controlHint')}</p>
        </div>
        <div className="sessions-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setModal('guide')}><BookOpen size={14} />{t('guideTitle')}</button>
          <button type="button" className="btn btn-primary" onClick={() => setModal('create')}><Plus size={14} />{t('newAgent')}</button>
        </div>
      </header>

      {boards && (
        <p className="sess-summary">
          <span><b>{totals.branches}</b> {t('ccBranches')}</span>
          <span className={totals.working ? 'is-live' : ''}>{totals.working > 0 && <i className="pulse" />}<b>{totals.working}</b> {t('ccWorking')}</span>
          <span><b>{totals.attention}</b> {t('ccAttention')}</span>
        </p>
      )}

      {shell && !shell.installed && (
        <div className="shell-tip">
          <SquareTerminal size={16} />
          <span><b>{t('shellTipTitle')}</b> <span className="muted">{t('shellTipText')}</span></span>
          <button type="button" className="link" onClick={async () => { try { setShell(await bridge.setShellIntegration(true)); toast('ok', t('shellOn')) } catch (e) { toast('error', (e as Error).message) } }}>{t('shellEnable')} →</button>
        </div>
      )}

      <Heatmap days={days} onOpen={() => setView('sessions')} />

      {boards === null && <p className="muted small"><Loader2 size={14} className="spin" /> {t('loadingRepo')}</p>}
      {boards?.length === 0 && (
        <div className="cc-empty">
          <p>{t('ccEmpty')}</p>
          <button type="button" className="btn btn-primary" onClick={() => setModal('create')}><Plus size={14} />{t('newAgent')}</button>
        </div>
      )}

      {boards?.map((board) => (
        <section key={board.repo} className="repo-card cc-board">
          <header className="cc-clickable" onClick={(e) => { if (!fromControl(e)) setRepo(board.repo) }}>
            <FolderGit2 size={15} /><b>{board.name}</b><span className="muted small">⎇ {board.health.base}</span>
            <span className="repo-card-actions">
              {board.github && <a className="icon-link" href={`https://github.com/${board.github}`} target="_blank" rel="noreferrer" title={board.github}><GithubIcon size={14} /></a>}
              <button type="button" className="link" onClick={() => setRepo(board.repo)}>{t('openRepo')}</button>
            </span>
          </header>
          <ul>
            {board.health.branches.map((b) => {
              const pr = board.prs.find((p) => p.branch === b.branch)
              const live = sessionsOf(board.repo, b.branch)
              const state = stateOf(live)
              const agent = b.agent || live[0]?.agent || b.running[0] || ''
              const next = nextAction(b, pr, !!board.github)
              const size = b.added + b.deleted
              const key = `${board.repo}#${b.branch}`
              return (
                <li key={b.path} className={`cc-row cc-clickable${b.main ? ' is-main' : ''}`} onClick={(e) => { if (!fromControl(e)) act('open', board, b) }}>
                  {agent ? <AgentBadge agent={agent} size={24} live={state === 'working'} /> : <span className="cc-noagent" />}
                  <span className="row-main">
                    <span className="row-top">
                      <button type="button" className="cc-branch" onClick={() => act('open', board, b)}>{b.main ? t('ccMainCheckout', { base: board.health.base }) : b.branch}</button>
                      {state && <span className={`state-chip is-${state}`}>{t(state === 'working' ? 'stateWorking' : state === 'waiting' ? 'stateWaiting' : 'stateIdle')}</span>}
                      {b.merged && <span className="chip chip-ok"><Check size={11} />{t('ccMerged')}</span>}
                    </span>
                    <span className="cc-facts">
                      {b.main ? <span className="chip chip-warn"><AlertTriangle size={11} />{t('ccOnMain')}</span> : null}
                      {b.ahead > 0 && <span className="chip">{b.ahead === 1 ? t('ccAheadOne') : t('ccAhead', { n: b.ahead })}</span>}
                      {b.behind > 0 && <span className={`chip${b.behind >= 20 ? ' chip-warn' : ''}`}>{t('ccBehind', { n: b.behind, base: board.health.base })}</span>}
                      {b.uncommitted > 0 && <span className="chip chip-warn">{t('ccUncommitted', { n: b.uncommitted })}</span>}
                      {size > 0 && (
                        <span className={`chip cc-size${size > BIG ? ' chip-warn' : ''}`} title={size > BIG ? t('ccBigHint') : undefined}>
                          <ins>+{b.added}</ins> <del>−{b.deleted}</del>{size > BIG && ` · ${t('ccBig')}`}
                        </span>
                      )}
                      {b.unpushed !== null && b.unpushed > 0 && <span className="chip">{t('ccUnpushed', { n: b.unpushed })}</span>}
                      {pr && (
                        <a className={`chip cc-pr is-${pr.draft && pr.state === 'OPEN' ? 'draft' : pr.state.toLowerCase()}`} href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>
                          <GitPullRequest size={11} />#{pr.number} · {t(pr.state === 'MERGED' ? 'prMerged' : pr.state === 'CLOSED' ? 'prClosed' : pr.draft ? 'prDraft' : 'prOpen')}
                        </a>
                      )}
                      {b.overlaps.length > 0 && <span className="chip chip-warn" title={t('ccOverlapHint')}><AlertTriangle size={11} />{t('ccOverlap', { branches: b.overlaps.join(', ') })}</span>}
                      {b.lastCommit && <span className="muted small">{relative(lang, b.lastCommit)}</span>}
                    </span>
                  </span>
                  <span className="cc-actions">
                    <button type="button" className={`btn ${next === 'move' || next === 'pr' || next === 'update' ? 'btn-primary' : 'btn-ghost'} btn-sm`} disabled={busy === key}
                      onClick={() => act(next, board, b, pr)}>
                      {busy === key ? <Loader2 size={13} className="spin" /> : <ActionIcon action={next} />}{actionLabel(t, next, agent)}
                    </button>
                    <RowMenu b={b} pr={pr} onGithub={!!board.github} onPick={(a) => act(a, board, b, pr)} />
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {confirm && (
        <Dialog
          title={actionLabel(t, confirm.action, confirm.b.agent || confirm.b.running[0] || '')}
          confirmLabel={actionLabel(t, confirm.action, confirm.b.agent || confirm.b.running[0] || '')}
          danger={confirm.action === 'remove'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { action, board, b } = confirm
            setConfirm(null)
            const key = `${board.repo}#${b.branch}`
            if (action === 'move') void run(key, () => bridge.moveToBranch(board.repo, b.running[0] || b.agent || 'claude'))
            if (action === 'pr') void run(key, () => bridge.openPr(board.repo, b.path))
            if (action === 'merge') void run(key, () => bridge.merge(board.repo, b.path))
            if (action === 'remove') void run(key, () => bridge.remove(board.repo, b.path, false))
          }}>
          <p>{t(`confirm_${confirm.action}` as 'confirm_move', { branch: confirm.b.branch, base: confirm.board.health.base, agent: confirm.b.running[0] || confirm.b.agent || 'claude' })}</p>
        </Dialog>
      )}
    </main>
  )
}

/** A click on a button, link or menu inside a card does its own thing, not the card's. */
const fromControl = (e: ReactMouseEvent) => !!(e.target as HTMLElement).closest('button, a, [role="menu"]')

function relative(lang: string, unix: number): string {
  const diff = unix - Math.floor(Date.now() / 1000)
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const a = Math.abs(diff)
  return a < 3600 ? rtf.format(Math.round(diff / 60), 'minute') : a < 86400 ? rtf.format(Math.round(diff / 3600), 'hour') : rtf.format(Math.round(diff / 86400), 'day')
}

function ActionIcon({ action }: { action: Action }) {
  if (action === 'update') return <ArrowDownToLine size={13} />
  if (action === 'pr' || action === 'view-pr') return <GitPullRequest size={13} />
  if (action === 'merge') return <GitMerge size={13} />
  if (action === 'remove') return <Trash2 size={13} />
  if (action === 'launch') return <Play size={13} />
  if (action === 'move') return <GitMerge size={13} />
  return <ExternalLink size={13} />
}

type T = ReturnType<typeof useStore.getState>['t']
function actionLabel(t: T, action: Action, agent: string): string {
  return t(({ move: 'actMove', update: 'actUpdate', pr: 'actPr', merge: 'actMerge', remove: 'actRemove', open: 'actOpen', launch: 'actLaunch', 'view-pr': 'actViewPr' } as const)[action], { agent: agent || 'agent' })
}

/** Every action of a branch, the less frequent ones out of the way. */
function RowMenu({ b, pr, onGithub, onPick }: { b: BranchHealth; pr?: PullRequest; onGithub: boolean; onPick: (a: Action) => void }) {
  const t = useStore((s) => s.t)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const items: Action[] = b.main ? ['move', 'open'] : ['open', 'launch', 'update', ...(onGithub && !pr ? ['pr' as const] : []), ...(pr?.state === 'OPEN' ? ['view-pr' as const] : []), 'merge', 'remove']
  const agent = b.agent || b.running[0] || ''
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="icon-btn ghost" aria-label={t('moreActions')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={16} /></button>
      {open && (
        <div className="popover menu-pop" role="menu">
          {items.map((a) => (
            <button key={a} type="button" role="menuitem" className={a === 'remove' ? 'is-danger' : ''} onClick={() => { setOpen(false); onPick(a) }}>
              <ActionIcon action={a} />{actionLabel(t, a, agent)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
