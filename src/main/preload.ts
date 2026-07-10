import { contextBridge, ipcRenderer } from 'electron';
import type {
  ArxivTitleAbstractTranslationRequest,
  ArxivTranslationBatchRequest
} from '../shared/arxiv';

contextBridge.exposeInMainWorld('electronAPI', {
  openPdf: () => ipcRenderer.invoke('dialog:open-pdf'),
  openTranslation: () => ipcRenderer.invoke('dialog:open-translation'),
  openTranslatedPdf: () => ipcRenderer.invoke('dialog:open-translated-pdf'),
  selectDirectory: (request?: { title?: string; defaultPath?: string }) =>
    ipcRenderer.invoke('dialog:select-directory', request),
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
  getLocalTranslationStatus: () => ipcRenderer.invoke('local-translation:status'),
  checkLocalTranslationInstall: () => ipcRenderer.invoke('local-translation:install-check'),
  warmUpLocalTranslation: () => ipcRenderer.invoke('local-translation:warmup'),
  getRuntimeCenterSnapshot: () => ipcRenderer.invoke('runtime-center:snapshot'),
  checkRuntimeCenter: () => ipcRenderer.invoke('runtime-center:check'),
  translateLocalBatch: (request: {
    texts: string[];
    forceEngine?: 'nllb-ct2' | 'argos';
    sourceLanguage?: 'en' | 'zh';
    targetLanguage?: 'en' | 'zh';
    timeoutMs?: number;
  }) => ipcRenderer.invoke('local-translation:translate-batch', request),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:open-external-url', url),
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
  searchArxiv: (request: {
    searchQuery: string;
    category: string;
    start: number;
    maxResults: number;
    sortBy: 'comprehensive' | 'relevance' | 'lastUpdatedDate' | 'submittedDate';
    sortOrder: 'ascending' | 'descending';
    yearFrom?: string;
    yearTo?: string;
    forceRefresh?: boolean;
  }) => ipcRenderer.invoke('arxiv:search', request),
  translateArxivTitleAbstract: (request: {
    stableId: string;
    title: string;
    summary: string;
    targetLanguage?: 'zh';
  }) => ipcRenderer.invoke('arxiv:translate-title-abstract', request),
  translateArxivTitleAbstractBatch: (
    request: ArxivTranslationBatchRequest | ArxivTitleAbstractTranslationRequest[]
  ) => ipcRenderer.invoke('arxiv:translate-title-abstract-batch', request),
  downloadArxivPdf: (request: { pdfUrl: string; defaultFileName: string }) =>
    ipcRenderer.invoke('arxiv:download-pdf', request),
  selectCodeRepository: () => ipcRenderer.invoke('code-repository:select'),
  scanCodeRepository: (request: { rootPath: string }) =>
    ipcRenderer.invoke('code-repository:scan', request),
  exportPdf: (request: { sourcePath: string; defaultFileName: string }) =>
    ipcRenderer.invoke('file:export-pdf', request),
  exportResearchWorkbookExcel: (request: { workbook: unknown }) =>
    ipcRenderer.invoke('research-workbook:export-excel', request),
  importResearchWorkbookExcel: () =>
    ipcRenderer.invoke('research-workbook:import-excel')
});
