export interface PdfFilePayload {
  filePath: string;
  fileName: string;
  base64: string;
}

export interface TextFilePayload {
  filePath: string;
  fileName: string;
  content: string;
}

export interface SaveTextResult {
  filePath: string;
  fileName: string;
}

export interface ProjectLoadResult {
  pdf: PdfFilePayload | null;
  translation: TextFilePayload | null;
  aiCache: TextFilePayload | null;
  translatedPdf: PdfFilePayload | null;
  translatedMonoPdf: PdfFilePayload | null;
  errors: string[];
}

export type AiProviderId = 'openai' | 'deepseek' | 'kimi' | 'custom';
export type AiThinkingMode = 'auto' | 'enabled' | 'disabled';
export type AiReasoningEffort = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AiSettingsView {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  thinkingMode?: AiThinkingMode;
  reasoningEffort?: AiReasoningEffort;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  apiKeyConfigured: boolean;
}

export interface AiTranslateResult {
  translation: string;
  translatedAt: string;
  provider: AiProviderId;
  model: string;
  skipped: boolean;
}

export interface AiConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface AiBalanceResult {
  supported: boolean;
  provider: AiProviderId;
  message: string;
  checkedAt?: string;
}

export interface AiModelOptionResult {
  value: string;
  label: string;
}

export interface AiModelsResult {
  supported: boolean;
  provider: AiProviderId;
  options: AiModelOptionResult[];
  message: string;
  checkedAt?: string;
}

export interface AiFillSheetCellResult {
  text: string;
  provider: AiProviderId;
  model: string;
  mode: 'openai-pdf-input' | 'kimi-file-extract' | 'local-text';
  cached: boolean;
}

export interface AiAnalyzeLiteratureResult {
  text: string;
  provider: AiProviderId;
  model: string;
  mode: 'openai-pdf-input' | 'kimi-file-extract' | 'local-text';
  cachedContextCount: number;
  webSearchUsed?: boolean;
}

export interface PdfTranslationEngineResult {
  available: boolean;
  executable?: string;
  invocation?: 'cli' | 'python-module';
  message: string;
  installCommand: string;
  autoInstall?: boolean;
}

export interface PdfTranslationProgress {
  paperId: string;
  status: 'running' | 'completed' | 'failed';
  message: string;
}

export interface PdfTranslationResult {
  status: 'cached' | 'completed';
  message: string;
  pdf: PdfFilePayload;
  monoPdf?: PdfFilePayload | null;
  translatedPdfPath: string;
  translatedPdfName: string;
  translatedMonoPdfPath?: string;
  translatedMonoPdfName?: string;
  translatedPdfMode: 'dual' | 'mono';
  translationEngine: 'pdfmathtranslate';
  translationSourceHash: string;
  translatedAt: string;
  translatedProvider: AiProviderId;
  translatedModel: string;
}

export interface ElectronApi {
  openPdf: () => Promise<PdfFilePayload | null>;
  openTranslation: () => Promise<TextFilePayload | null>;
  openTranslatedPdf: () => Promise<PdfFilePayload | null>;
  loadProject: (request: {
    pdfPath?: string;
    translationPath?: string;
    aiCachePath?: string;
    translatedPdfPath?: string;
    translatedMonoPdfPath?: string;
  }) => Promise<ProjectLoadResult>;
  checkPdfTranslationEngine: () => Promise<PdfTranslationEngineResult>;
  translatePdf: (request: {
    paperId: string;
    pdfPath: string;
    outputMode?: 'dual' | 'mono';
    force?: boolean;
  }) => Promise<PdfTranslationResult>;
  onPdfTranslationProgress: (
    callback: (progress: PdfTranslationProgress) => void
  ) => () => void;
  loadAiSettings: () => Promise<AiSettingsView>;
  saveAiSettings: (request: {
    provider: AiProviderId;
    baseURL: string;
    model: string;
    thinkingMode?: AiThinkingMode;
    reasoningEffort?: AiReasoningEffort;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutSeconds?: number;
    maxRetries?: number;
    apiKey?: string;
  }) => Promise<AiSettingsView>;
  translateWithAi: (request: {
    section: string;
    original: string;
    translation: string;
    type?: 'heading' | 'paragraph' | 'formula' | 'caption';
    sourceHash?: string;
    force?: boolean;
  }) => Promise<AiTranslateResult>;
  completeWithAi: (request: {
    systemPrompt: string;
    userPrompt: string;
  }) => Promise<string>;
  fillSheetCellWithAi: (request: {
    paperId: string;
    pdfPath: string;
    fallbackContextText: string;
    systemPrompt: string;
    userPrompt: string;
  }) => Promise<AiFillSheetCellResult>;
  fillSheetCellsWithAi: (request: {
    paperId: string;
    pdfPath: string;
    fallbackContextText: string;
    cellCount: number;
    systemPrompt: string;
    userPrompt: string;
  }) => Promise<AiFillSheetCellResult>;
  analyzeLiteratureWithAi: (request: {
    papers: Array<{
      paperId: string;
      pdfPath: string;
      fallbackContextText: string;
    }>;
    systemPrompt: string;
    userPrompt: string;
  }) => Promise<AiAnalyzeLiteratureResult>;
  testAiConnection: () => Promise<AiConnectionTestResult>;
  getAiBalance: () => Promise<AiBalanceResult>;
  getAiModels: () => Promise<AiModelsResult>;
  saveTextFile: (request: {
    filePath?: string;
    content: string;
    defaultFileName: string;
    extension: 'json' | 'md';
  }) => Promise<SaveTextResult | null>;
  saveTranslationCache: (request: {
    filePath?: string;
    content: string;
    defaultFileName: string;
  }) => Promise<SaveTextResult | null>;
  exportMarkdown: (request: {
    filePath?: string;
    content: string;
    defaultFileName: string;
  }) => Promise<SaveTextResult | null>;
  exportPptx: (request: {
    filePath?: string;
    contentBase64: string;
    defaultFileName: string;
  }) => Promise<SaveTextResult | null>;
  downloadArxivPdf: (request: {
    pdfUrl: string;
    defaultFileName: string;
  }) => Promise<PdfFilePayload | null>;
  exportPdf: (request: {
    sourcePath: string;
    defaultFileName: string;
  }) => Promise<SaveTextResult | null>;
  exportResearchWorkbookExcel: (request: {
    workbook: unknown;
  }) => Promise<SaveTextResult | null>;
  importResearchWorkbookExcel: () => Promise<{
    filePath: string;
    fileName: string;
    workbook: unknown;
  } | null>;
}

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}
