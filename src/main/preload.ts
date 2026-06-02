import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openPdf: () => ipcRenderer.invoke('dialog:open-pdf'),
  openTranslation: () => ipcRenderer.invoke('dialog:open-translation'),
  openTranslatedPdf: () => ipcRenderer.invoke('dialog:open-translated-pdf'),
  loadProject: (request: {
    pdfPath?: string;
    translationPath?: string;
    aiCachePath?: string;
    translatedPdfPath?: string;
    translatedMonoPdfPath?: string;
  }) =>
    ipcRenderer.invoke('project:load', request),
  checkPdfTranslationEngine: () => ipcRenderer.invoke('pdf-translation:check-engine'),
  translatePdf: (request: {
    paperId: string;
    pdfPath: string;
    outputMode?: 'dual' | 'mono';
    force?: boolean;
  }) => ipcRenderer.invoke('pdf-translation:translate', request),
  onPdfTranslationProgress: (callback: (progress: {
    paperId: string;
    status: 'running' | 'completed' | 'failed';
    message: string;
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: {
      paperId: string;
      status: 'running' | 'completed' | 'failed';
      message: string;
    }) => callback(progress);
    ipcRenderer.on('pdf-translation:progress', listener);
    return () => ipcRenderer.removeListener('pdf-translation:progress', listener);
  },
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
  completeWithAi: (request: { systemPrompt: string; userPrompt: string }) =>
    ipcRenderer.invoke('ai:complete', request),
  fillSheetCellWithAi: (request: {
    paperId: string;
    pdfPath: string;
    fallbackContextText: string;
    systemPrompt: string;
    userPrompt: string;
  }) => ipcRenderer.invoke('ai:fill-sheet-cell', request),
  fillSheetCellsWithAi: (request: {
    paperId: string;
    pdfPath: string;
    fallbackContextText: string;
    cellCount: number;
    systemPrompt: string;
    userPrompt: string;
  }) => ipcRenderer.invoke('ai:fill-sheet-cells', request),
  analyzeLiteratureWithAi: (request: {
    papers: Array<{
      paperId: string;
      pdfPath: string;
      fallbackContextText: string;
    }>;
    systemPrompt: string;
    userPrompt: string;
  }) => ipcRenderer.invoke('ai:analyze-literature', request),
  testAiConnection: () => ipcRenderer.invoke('ai:test-connection'),
  getAiBalance: () => ipcRenderer.invoke('ai:balance'),
  getAiModels: () => ipcRenderer.invoke('ai:models'),
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
    ipcRenderer.invoke('file:export-markdown', request),
  exportPptx: (request: { filePath?: string; contentBase64: string; defaultFileName: string }) =>
    ipcRenderer.invoke('file:export-pptx', request),
  exportPdf: (request: { sourcePath: string; defaultFileName: string }) =>
    ipcRenderer.invoke('file:export-pdf', request),
  exportResearchWorkbookExcel: (request: { workbook: unknown }) =>
    ipcRenderer.invoke('research-workbook:export-excel', request),
  importResearchWorkbookExcel: () =>
    ipcRenderer.invoke('research-workbook:import-excel')
});
