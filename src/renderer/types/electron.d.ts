import type {
  ArxivSearchRequest,
  ArxivSearchServiceResult,
  ArxivTitleAbstractTranslationRequest,
  ArxivTitleAbstractTranslationResult,
  ArxivTranslationBatchRequest
} from '../../shared/arxiv';
import type {
  PlotDataTable,
  PlotArtifactPayload,
  PlotGeneratedArtifactExportRequest,
  PlotRenderJob,
  PlotRuntimeCapability,
  PlotRuntimeInstallJob,
  ScientificPlotProjectLoadResult,
  ScientificPlotProjectManifest,
  ScientificPlotSpec
} from '../../shared/scientificPlot';
import type { WordDictionaryLookupResult } from '../../shared/wordDictionary';
import type { FigureAssetsExportRequest, FigureAssetsExportResult } from '../../shared/figureAssets';

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

export interface DirectoryPayload {
  directoryPath: string;
  directoryName: string;
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
  cacheHit?: boolean;
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

export interface LocalTranslationStatus {
  preferredEngine: 'nllb-first' | 'argos-first' | 'nllb-only' | 'argos-only';
  nllb: {
    configured: boolean;
    available: boolean;
    pythonPath: string;
    modelDir: string;
    tokenizerDir: string;
    device: 'auto' | 'cuda' | 'cpu';
    runtimeDevice: 'cuda' | 'cpu' | 'unknown';
    runtimeState: 'not_checked' | 'warming' | 'ready' | 'cpu_fallback' | 'failed';
    cudaDllDirs: string[];
    lastRuntimeError: string;
    lastFallbackReason: string;
    lastCheckedAt: string;
    warmupMs: number;
    message: string;
  };
  fallback: {
    engine: 'argos';
    message: string;
  };
  worker: {
    running: boolean;
    pending: number;
  };
}

export interface LocalTranslateBatchResult {
  texts: string[];
  engine: 'nllb-ct2-int8' | 'argos';
  device?: 'cuda' | 'cpu' | 'unknown';
  model?: string;
  warning?: string;
  fallbackReason?: string;
}

export type RuntimeCapabilityStatus = 'ready' | 'degraded' | 'unavailable' | 'unknown';

export interface RuntimeCenterSnapshot {
  generatedAt: string;
  overallStatus: RuntimeCapabilityStatus;
  capabilities: Array<{
    id: 'nllb' | 'argos' | 'pdf2zh' | 'ai-provider';
    label: string;
    status: RuntimeCapabilityStatus;
    message: string;
    details: Record<string, string | number | boolean | string[]>;
  }>;
  queue: {
    items: Array<{
      id: string;
      kind: 'local-translation' | 'pdf-translation' | 'ai-provider' | 'cache';
      status: 'idle' | 'running' | 'queued' | 'failed';
      label: string;
      message?: string;
    }>;
    pendingCount: number;
    runningCount: number;
    failedCount: number;
  };
  actions: string[];
}

export interface CodeRepositoryScanResult {
  id: string;
  rootPath: string;
  scannedAt: string;
  files: Array<{
    filePath: string;
    fileName: string;
    extension: string;
    bytes: number;
    role: 'readme' | 'manifest' | 'entry' | 'config' | 'script' | 'source' | 'other';
    excerpt: string;
  }>;
  manifests: Array<{
    filePath: string;
    fileName: string;
    kind: string;
    dependencies: string[];
  }>;
  entryPoints: Array<{
    filePath: string;
    kind: string;
    commandCandidate: string;
    reason: string;
  }>;
  configFiles: Array<{
    filePath: string;
    fileName: string;
    extension: string;
    bytes: number;
    role: 'readme' | 'manifest' | 'entry' | 'config' | 'script' | 'source' | 'other';
    excerpt: string;
  }>;
  risks: string[];
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
  fileExists: (filePath: string) => Promise<boolean>;
  selectDirectory: (request?: { title?: string; defaultPath?: string }) => Promise<DirectoryPayload | null>;
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
  getLocalTranslationStatus: () => Promise<LocalTranslationStatus>;
  checkLocalTranslationInstall: () => Promise<LocalTranslationStatus>;
  warmUpLocalTranslation: () => Promise<LocalTranslationStatus>;
  getRuntimeCenterSnapshot: () => Promise<RuntimeCenterSnapshot>;
  checkRuntimeCenter: () => Promise<RuntimeCenterSnapshot>;
  translateLocalBatch: (request: {
    texts: string[];
    forceEngine?: 'nllb-ct2' | 'argos';
    sourceLanguage?: 'en' | 'zh';
    targetLanguage?: 'en' | 'zh';
    timeoutMs?: number;
  }) => Promise<LocalTranslateBatchResult>;
  lookupEnglishWord: (word: string) => Promise<WordDictionaryLookupResult>;
  openExternalUrl: (url: string) => Promise<boolean>;
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
  exportFigureAssets: (request: FigureAssetsExportRequest) => Promise<FigureAssetsExportResult | null>;
  searchArxiv: (request: ArxivSearchRequest) => Promise<ArxivSearchServiceResult>;
  translateArxivTitleAbstract: (
    request: ArxivTitleAbstractTranslationRequest
  ) => Promise<ArxivTitleAbstractTranslationResult>;
  translateArxivTitleAbstractBatch: (
    request: ArxivTranslationBatchRequest | ArxivTitleAbstractTranslationRequest[]
  ) => Promise<ArxivTitleAbstractTranslationResult[]>;
  downloadArxivPdf: (request: {
    pdfUrl: string;
    defaultFileName: string;
  }) => Promise<PdfFilePayload | null>;
  selectCodeRepository: () => Promise<{ rootPath: string } | null>;
  scanCodeRepository: (request: { rootPath: string }) => Promise<CodeRepositoryScanResult>;
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
  listScientificPlotProjects: () => Promise<ScientificPlotProjectManifest[]>;
  createScientificPlotProject: (request: { spec: ScientificPlotSpec; data?: PlotDataTable }) => Promise<ScientificPlotProjectManifest>;
  loadScientificPlotProject: (projectId: string) => Promise<ScientificPlotProjectLoadResult>;
  saveScientificPlotSpec: (spec: ScientificPlotSpec) => Promise<ScientificPlotProjectManifest>;
  selectScientificPlotDataFile: () => Promise<{
    filePath: string;
    fileName: string;
    kind: 'delimited' | 'excel';
    sheets: string[];
  } | null>;
  readScientificPlotDataFile: (request: {
    filePath: string;
    sheetName?: string;
    headerRow?: number;
    delimiter?: string;
    encoding?: string;
  }) => Promise<PlotDataTable>;
  detectScientificPlotRuntimes: () => Promise<PlotRuntimeCapability[]>;
  getScientificPlotInstallerIntent: () => Promise<{ python: boolean; r: boolean; matlabDetect: boolean }>;
  acknowledgeScientificPlotInstallerIntent: () => Promise<boolean>;
  startScientificPlotRuntimeInstall: (request: { language: 'python' | 'r'; targetRoot?: string }) => Promise<PlotRuntimeInstallJob>;
  repairScientificPlotRuntime: (language: 'python' | 'r') => Promise<PlotRuntimeInstallJob>;
  getScientificPlotRuntimeInstallJob: (jobId: string) => Promise<PlotRuntimeInstallJob | undefined>;
  cancelScientificPlotRuntimeInstall: (jobId: string) => Promise<boolean>;
  removeScientificPlotManagedRuntime: (request: { language: 'python' | 'r'; targetRoot?: string }) => Promise<boolean>;
  submitScientificPlotRender: (request: { projectId: string; spec: ScientificPlotSpec; data: PlotDataTable; force?: boolean }) => Promise<PlotRenderJob>;
  getScientificPlotRenderJob: (jobId: string) => Promise<PlotRenderJob | undefined>;
  cancelScientificPlotRender: (jobId: string) => Promise<boolean>;
  exportScientificPlotPackage: (request: { projectId: string; includeRawData?: boolean; includeDerivedData?: boolean }) => Promise<SaveTextResult | null>;
  importScientificPlotPackage: () => Promise<{ projectId: string } | null>;
  exportScientificPlotArtifact: (request: { filePath: string; defaultFileName: string }) => Promise<SaveTextResult | null>;
  exportScientificPlotGeneratedArtifact: (request: PlotGeneratedArtifactExportRequest) => Promise<SaveTextResult | null>;
  readScientificPlotArtifact: (filePath: string) => Promise<PlotArtifactPayload>;
}

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}
