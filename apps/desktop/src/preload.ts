import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('agentWt', {
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke('agent-wt', method, args),
})
