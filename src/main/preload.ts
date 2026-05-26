import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openPdf: () => ipcRenderer.invoke('dialog:open-pdf'),
  openTranslation: () => ipcRenderer.invoke('dialog:open-translation'),
  loadProject: (request: { pdfPath?: string; translationPath?: string }) =>
    ipcRenderer.invoke('project:load', request),
  saveTextFile: (request: {
    filePath?: string;
    content: string;
    defaultFileName: string;
    extension: 'json' | 'md';
  }) => ipcRenderer.invoke('file:save-text', request),
  exportMarkdown: (request: { filePath?: string; content: string; defaultFileName: string }) =>
    ipcRenderer.invoke('file:export-markdown', request)
});
