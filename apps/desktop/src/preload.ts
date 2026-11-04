import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ramify', {
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke('ramify', method, args),
  on: (cb: (payload: unknown) => void) => { ipcRenderer.on('ramify:event', (_e, payload) => cb(payload)) },
})
