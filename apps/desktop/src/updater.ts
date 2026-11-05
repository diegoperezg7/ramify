// The app's own updates, from GitHub releases (electron-updater reads latest-mac.yml / latest.yml there).
// Nothing is downloaded until the user asks: a newer version is only offered, and installed on restart.
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../../../packages/core/src/types.ts'

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 4 * 60 * 60_000

export function createUpdater(opts: { enabled: () => boolean; onChange: () => void }) {
  let state: UpdateState = { status: 'none' }
  const set = (next: UpdateState) => { state = next; opts.onChange() }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('update-available', (info) => {
    if (state.status === 'none' || state.status === 'available' || state.status === 'error') set({ status: 'available', version: info.version })
  })
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor(p.percent)
    if (state.status !== 'downloading' || percent !== state.percent) set({ status: 'downloading', version: state.version, percent })
  })
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }))
  // A check that fails (offline, GitHub down) says nothing: it tries again later. A download that fails is shown.
  autoUpdater.on('error', (e) => {
    if (state.status === 'downloading') set({ status: 'error', version: state.version, error: e?.message ?? String(e) })
  })

  const check = () => {
    if (!opts.enabled() || state.status === 'downloading' || state.status === 'ready') return
    autoUpdater.checkForUpdates().catch(() => { /* reported through the error event, or silent */ })
  }

  return {
    start() {
      setTimeout(check, FIRST_CHECK_MS)
      setInterval(check, CHECK_EVERY_MS)
    },
    /** Settings changed: a check now when turned on. */
    check,
    state: (): UpdateState => state,
    async download() {
      if (state.status !== 'available' && state.status !== 'error') return
      set({ status: 'downloading', version: state.version, percent: 0 })
      try {
        await autoUpdater.downloadUpdate()
      } catch (e) {
        set({ status: 'error', version: state.version, error: (e as Error).message })
      }
    },
    install() {
      if (state.status !== 'ready') return
      // After the IPC reply has gone out: quitting closes the window that asked.
      setImmediate(() => autoUpdater.quitAndInstall(false, true))
    },
  }
}
