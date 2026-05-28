import type { AiProviderSettings } from './aiTranslation';

export type PdfTranslationEngine = 'pdfmathtranslate';
export type PdfTranslationOutputMode = 'dual' | 'mono';
export type PdfTranslationJobStatus = 'unavailable' | 'idle' | 'running' | 'cached' | 'completed' | 'failed';

export interface PdfTranslationCommandInput {
  executable: string;
  pdfPath: string;
  outputDir: string;
  mode: PdfTranslationOutputMode;
  settings: AiProviderSettings;
}

export interface PdfTranslationCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PdfTranslationOutputPaths {
  dualPdfPath: string;
  monoPdfPath: string;
}

export interface PdfTranslationSourceIdentity {
  pdfPath: string;
  fileSize: number;
  mtimeMs: number;
}

export interface PdfTranslationRecordFields {
  translatedPdfPath?: string;
  translatedPdfName?: string;
  translatedPdfMode?: PdfTranslationOutputMode;
  translationEngine?: PdfTranslationEngine;
  translationSourceHash?: string;
  translatedAt?: string;
  translatedProvider?: string;
  translatedModel?: string;
}

export function buildPdf2zhCommand(input: PdfTranslationCommandInput): PdfTranslationCommand {
  const args = [
    input.pdfPath,
    '-s',
    'openai',
    '-li',
    'en',
    '-lo',
    'zh',
    '-o',
    input.outputDir
  ];

  if (input.mode === 'dual') {
    args.push('--no-mono');
  } else {
    args.push('--no-dual');
  }

  return {
    command: input.executable,
    args,
    env: {
      OPENAI_BASE_URL: input.settings.baseURL.replace(/\/+$/u, ''),
      OPENAI_MODEL: input.settings.model
    }
  };
}

export function buildPdfTranslationOutputPaths(input: {
  pdfPath: string;
  outputDir: string;
}): PdfTranslationOutputPaths {
  const stem = getFileStem(input.pdfPath);
  return {
    dualPdfPath: joinPath(input.outputDir, `${stem}-dual.pdf`),
    monoPdfPath: joinPath(input.outputDir, `${stem}-mono.pdf`)
  };
}

export function buildPdfTranslationSourceHash(identity: PdfTranslationSourceIdentity): string {
  return hashString([
    normalizePathForHash(identity.pdfPath),
    String(identity.fileSize),
    String(Math.round(identity.mtimeMs))
  ].join('|'));
}

export function sanitizePdfTranslationLog(value: string, apiKey?: string): string {
  let sanitized = value;

  if (apiKey) {
    sanitized = sanitized.split(apiKey).join('[REDACTED_API_KEY]');
  }

  return sanitized.replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED_API_KEY]');
}

function getFileStem(filePath: string): string {
  const fileName = filePath.replace(/\\/gu, '/').split('/').pop() || 'translated';
  return fileName.replace(/\.[^.]+$/u, '') || 'translated';
}

function joinPath(dir: string, fileName: string): string {
  return `${dir.replace(/[\\/]+$/u, '')}/${fileName}`;
}

function normalizePathForHash(filePath: string): string {
  return filePath.replace(/\\/gu, '/').toLowerCase();
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
