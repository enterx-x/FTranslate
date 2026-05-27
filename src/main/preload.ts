import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openPdf: () => ipcRenderer.invoke('dialog:open-pdf'),
  openTranslation: () => ipcRenderer.invoke('dialog:open-translation'),
  loadProject: (request: { pdfPath?: string; translationPath?: string }) =>
    ipcRenderer.invoke('project:load', request),
  loadAiSettings: () => ipcRenderer.invoke('ai-settings:load'),
  saveAiSettings: (request: {
    provider: 'openai' | 'deepseek' | 'kimi' | 'custom';
    baseURL: string;
    model: string;
    apiKey?: string;
  }) => ipcRenderer.invoke('ai-settings:save', request),
  translateWithAi: (request: {
    section: string;
    original: string;
    translation: string;
    type?: 'heading' | 'paragraph' | 'formula' | 'caption';
    sourceHash?: string;
    force?: boolean;
  }) => ipcRenderer.invoke('ai:translate', request),
  testAiConnection: () => ipcRenderer.invoke('ai:test-connection'),
  saveTextFile: (request: {
    filePath?: string;
    content: string;
    defaultFileName: string;
    extension: 'json' | 'md';
  }) => ipcRenderer.invoke('file:save-text', request),
  saveTranslationCache: (request: {
    filePath?: string;
    content: string;
    defaultFileName: string;
  }) => ipcRenderer.invoke('file:save-translation-cache', request),
  exportMarkdown: (request: { filePath?: string; content: string; defaultFileName: string }) =>
    ipcRenderer.invoke('file:export-markdown', request)
});
