import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/channels'
import type { TwirlyApi } from '@shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TwirlyApi = {
  pathForFile: (file) => webUtils.getPathForFile(file),
  inspect: (paths) => ipcRenderer.invoke(IPC.inspectFiles, paths),
  capabilities: () => ipcRenderer.invoke(IPC.capabilities),
  diagnostics: (refresh = false) => ipcRenderer.invoke(IPC.diagnostics, refresh),
  runJob: (req) => ipcRenderer.invoke(IPC.runJob, req),
  cancelJob: (jobId) => ipcRenderer.invoke(IPC.cancelJob, jobId),
  onJobProgress: (cb) => subscribe(IPC.jobProgress, cb),
  openEditor: (req) => ipcRenderer.invoke(IPC.openEditor, req),
  editorContext: () => ipcRenderer.invoke(IPC.editorContext),
  imagePreview: (path, maxSize) => ipcRenderer.invoke(IPC.imagePreview, { path, maxSize }),
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory),
  closeWindow: () => ipcRenderer.invoke(IPC.closeWindow),
  minimizeWindow: () => ipcRenderer.invoke(IPC.minimizeWindow),
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    onChange: (cb) => subscribe(IPC.settingsChanged, cb),
  },
  contextMenu: (action) => ipcRenderer.invoke(IPC.contextMenu, action),
  pdfBytes: (path) => ipcRenderer.invoke(IPC.pdfBytes, path),
  mediaOpen: (path) => ipcRenderer.invoke(IPC.mediaOpen, path),
  imageMetadata: (path) => ipcRenderer.invoke(IPC.imageMetadata, path),
  pdfWorker: {
    onRequest: (cb) => subscribe(IPC.pdfWorkerRequest, cb),
    respond: (res) => ipcRenderer.send(IPC.pdfWorkerResponse, res),
  },
  wheel: {
    onShow: (cb) => subscribe(IPC.wheelShow, cb),
    onHide: (cb) => subscribe(IPC.wheelHide, () => cb()),
    onDragState: (cb) => subscribe(IPC.wheelDragState, cb),
    dismiss: () => ipcRenderer.invoke(IPC.wheelDismiss),
  },
}

contextBridge.exposeInMainWorld('twirly', api)
