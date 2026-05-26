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

export interface ElectronApi {
  openPdf: () => Promise<PdfFilePayload | null>;
  openTranslation: () => Promise<TextFilePayload | null>;
  loadProject: (request: { pdfPath?: string; translationPath?: string }) => Promise<ProjectLoadResult>;
  saveTextFile: (request: {
    filePath?: string;
    content: string;
    defaultFileName: string;
    extension: 'json' | 'md';
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
