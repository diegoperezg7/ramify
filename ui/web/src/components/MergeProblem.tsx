import { Check, Copy, FileWarning, GitMerge, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Key } from '../i18n'

/**
 * A merge that did not happen, said in plain words: why, that nothing changed, and what to do next
 * (with the command that starts it when there is a conflict). Replaces the bare git output in a toast.
 */
export function MergeProblemDialog() {
  const t = useStore((s) => s.t)
  const p = useStore((s) => s.mergeProblem)
  const close = useStore((s) => s.setMergeProblem)
  const ref = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  if (!p) return null

  const v = { branch: p.branch, base: p.base }
  const text: Record<typeof p.kind, [Key, Key]> = {
    conflict: ['mpConflictWhy', 'mpConflictWhat'],
    generated: ['mpGeneratedWhy', 'mpGeneratedWhat'],
    'dirty-main': ['mpDirtyMainWhy', 'mpDirtyMainWhat'],
    'dirty-branch': ['mpDirtyBranchWhy', 'mpDirtyBranchWhat'],
    other: ['mpOtherWhy', 'mpOtherWhat'],
  }
  const [why, what] = text[p.kind]
  const waiting = p.kind === 'dirty-main' || p.kind === 'dirty-branch'
  const command = `git -C "${p.path}" merge ${p.base}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* denied */ }
  }

  return (
    <dialog ref={ref} className="dialog merge-problem" onCancel={(e) => { e.preventDefault(); close(null) }} aria-labelledby="mp-title">
      <header className="mp-head">
        <span className={`mp-icon is-${waiting ? 'wait' : 'stop'}`}>{waiting ? <GitMerge size={20} /> : <TriangleAlert size={20} />}</span>
        <div>
          <h3 id="mp-title">{t(waiting ? 'mpTitleWait' : 'mpTitle', v)}</h3>
          <p className="mp-safe"><Check size={13} />{t('mpNothing', v)}</p>
        </div>
      </header>

      <section className="mp-block">
        <h4>{t('mpWhy')}</h4>
        <p>{t(why, v)}</p>
        {p.kind === 'conflict' && p.files.length > 0 && (
          <ul className="mp-files">{p.files.map((f) => <li key={f}><FileWarning size={13} /><code>{f}</code></li>)}</ul>
        )}
        {p.detail && <pre className="mp-detail">{p.detail}</pre>}
      </section>

      <section className="mp-block">
        <h4>{t('mpWhat')}</h4>
        <p>{t(what, v)}</p>
        {p.kind === 'conflict' && (
          <div className="mp-command">
            <code>{command}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? t('copied') : t('mpCopy')}</button>
          </div>
        )}
      </section>

      <div className="dialog-actions">
        <span className="sb-spacer" />
        <button type="button" className="btn btn-primary" onClick={() => close(null)} autoFocus>{t('mpOk')}</button>
      </div>
    </dialog>
  )
}
