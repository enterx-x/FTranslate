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
  errors: string[];
}

export type AiProviderId = 'openai' | 'deepseek' | 'kimi' | 'custom';

export interface AiSettingsView {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  apiKeyConfigured: boolean;
}

export interface AiTranslateResult {
  translation: string;
  translatedAt: string;
  provider: AiProviderId;
  model: string;
  skipped: boolean;
}

export interface ElectronApi {
  openPdf: () => Promise<PdfFilePayload | null>;
  openTranslation: () => Promise<TextFilePayload | null>;
  loadProject: (request: { pdfPath?: string; translationPath?: string }) => Promise<ProjectLoadResult>;
  loadAiSettings: () => Promise<AiSettingsView>;
  saveAiSettings: (request: {
    provider: AiProviderId;
    baseURL: string;
    model: string;
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
}

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}
