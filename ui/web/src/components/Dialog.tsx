import { useEffect, useRef, type ReactNode } from 'react'
import { useStore } from '../store'

interface Props {
  title: string
  confirmLabel: string
  danger?: boolean
  children: ReactNode
  onCancel: () => void
  onConfirm: () => void
}

export function Dialog({ title, confirmLabel, danger, children, onCancel, onConfirm }: Props) {
  const t = useStore((s) => s.t)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])

  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <h3>{title}</h3>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('cancel')}</button>
        <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm} autoFocus>{confirmLabel}</button>
      </div>
    </dialog>
  )
}
