import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { bridge } from '../bridge'
import { useStore } from '../store'

/** A newer version of the desktop app: offered in the corner, downloaded on request, installed on restart. */
export function UpdateNotice() {
  const update = useStore((s) => s.update)
  const t = useStore((s) => s.t)
  const [dismissed, setDismissed] = useState<string | null>(null)
  // Put off: it slides out first and is removed by a timer, so it also goes away with reduced motion (no animationend then).
  const [leaving, setLeaving] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!update || update.status === 'none' || dismissed === `${update.status}:${update.version}`) return null
  const version = update.version ?? ''
  const percent = update.percent ?? 0

  return (
    <div className={`toast update-notice${leaving === `${update.status}:${update.version}` ? ' is-leaving' : ''}`} role="status">
      {update.status === 'ready' ? <RefreshCw size={16} /> : <Download size={16} />}
      <div className="update-body" key={update.status}>
        {update.status === 'available' && (
          <>
            <b>{t('updateAvailable', { version })}</b>
            <span className="update-note">{t('updateAvailableNote')}</span>
            <div className="update-actions">
              <button type="button" className="btn btn-primary" onClick={() => void bridge.updateDownload?.()}>{t('updateDownload')}</button>
            </div>
          </>
        )}
        {update.status === 'downloading' && (
          <>
            <b>{t('updateDownloading', { version })}</b>
            <div className="update-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <span className="update-note">{percent}%</span>
          </>
        )}
        {update.status === 'ready' && (
          <>
            <b>{t('updateReady', { version })}</b>
            <span className="update-note">{t('updateReadyNote')}</span>
            <div className="update-actions">
              <button type="button" className="btn btn-primary" onClick={() => void bridge.updateInstall?.()}>{t('updateRestart')}</button>
            </div>
          </>
        )}
        {update.status === 'error' && (
          <>
            <b>{t('updateFailed')}</b>
            <span className="update-note">{update.error}</span>
            <div className="update-actions">
              <button type="button" className="btn" onClick={() => void bridge.updateDownload?.()}>{t('updateRetry')}</button>
            </div>
          </>
        )}
      </div>
      {update.status !== 'downloading' && (
        <button type="button" className="icon-btn update-close" aria-label={t('updateLater')} title={t('updateLater')}
          onClick={() => {
            const key = `${update.status}:${update.version}`
            setLeaving(key)
            timer.current = setTimeout(() => setDismissed(key), 200)
          }}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
