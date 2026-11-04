import { Check, GitBranch, GitMerge, GitPullRequest, Plus, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bridge } from '../bridge'
import { useStore } from '../store'
import { AgentBadge } from './AgentBadge'

/** How to work with several agents at once: one agent, one branch, one folder. */
export function Guide() {
  const t = useStore((s) => s.t)
  const caps = useStore((s) => s.caps)
  const setModal = useStore((s) => s.setModal)
  const toast = useStore((s) => s.toast)
  const ref = useRef<HTMLDialogElement>(null)
  const [shell, setShell] = useState<{ installed: boolean; rc: string } | null>(null)

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    if (caps?.control) void bridge.shellIntegration().then(setShell).catch(() => setShell(null))
    return () => d?.close()
  }, [caps])

  const toggle = async () => {
    if (!shell) return
    try {
      const next = await bridge.setShellIntegration(!shell.installed)
      setShell(next)
      toast('ok', next.installed ? t('shellOn') : t('shellOff'))
    } catch (e) { toast('error', (e as Error).message) }
  }

  return (
    <dialog ref={ref} className="dialog guide" onCancel={(e) => { e.preventDefault(); setModal(null) }}>
      <div className="dialog-head">
        <h3>{t('guideTitle')}</h3>
        <button type="button" className="icon-btn" onClick={() => setModal(null)} aria-label={t('close')}><X size={16} /></button>
      </div>

      <div className="guide-map" aria-hidden="true">
        <div className="gm-base"><GitBranch size={14} />main</div>
        {[['claude', 'claude/add-login'], ['codex', 'codex/fix-cart'], ['gemini', 'gemini/search']].map(([a, br]) => (
          <div key={a} className="gm-lane"><span className="gm-fork" /><AgentBadge agent={a} size={20} /><span className="gm-branch">{br}</span><span className="gm-folder">~/.worktrees/…/{br.split('/')[1]}</span></div>
        ))}
      </div>
      <p className="guide-lead">{t('guideLead')}</p>

      <ol className="guide-steps">
        <li>
          <span className="gs-num">1</span>
          <div>
            <b>{t('guide1')}</b>
            <p>{t('guide1Text')}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal('create')}><Plus size={13} />{t('newAgent')}</button>
          </div>
        </li>
        <li>
          <span className="gs-num">2</span>
          <div>
            <b>{t('guide2')}</b>
            <p>{t('guide2Text')}</p>
            {shell && (
              <label className="guide-toggle">
                <input type="checkbox" checked={shell.installed} onChange={toggle} />
                <SquareTerminal size={14} />{t('shellToggle')}
              </label>
            )}
            <pre className="guide-code">{`cd ~/code/shop\nclaude            # ${t('guideCodeNote')}\nramify new feat/login -a codex -p "magic links"`}</pre>
          </div>
        </li>
        <li>
          <span className="gs-num">3</span>
          <div><b>{t('guide3')}</b><p>{t('guide3Text')}</p></div>
        </li>
        <li>
          <span className="gs-num">4</span>
          <div><b>{t('guide4')}</b><p>{t('guide4Text')}</p></div>
        </li>
      </ol>

      <h4 className="pane-kicker">{t('practicesTitle')}</h4>
      <ul className="guide-practices">
        <li><GitBranch size={14} />{t('practice1')}</li>
        <li><Check size={14} />{t('practice2')}</li>
        <li><GitPullRequest size={14} />{t('practice3')}</li>
        <li><GitMerge size={14} />{t('practice4')}</li>
      </ul>
    </dialog>
  )
}
