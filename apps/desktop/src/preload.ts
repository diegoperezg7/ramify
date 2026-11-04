import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('agentWt', {
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke('agent-wt', method, args),
  on: (cb: (payload: unknown) => void) => { ipcRenderer.on('agent-wt:event', (_e, payload) => cb(payload)) },
})
