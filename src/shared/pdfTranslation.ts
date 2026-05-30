import { isKimiK2Model, resolveAiRuntimeOptions, type AiProviderSettings } from './aiTranslation';

export type PdfTranslationEngine = 'pdfmathtranslate';
export type PdfTranslationOutputMode = 'dual' | 'mono';
export type PdfTranslationJobStatus = 'unavailable' | 'idle' | 'running' | 'cached' | 'completed' | 'failed';
export type PdfTranslationInvocation = 'cli' | 'python-module';

export interface PdfTranslationCommandInput {
  executable: string;
  invocation?: PdfTranslationInvocation;
  pdfPath: string;
  outputDir: string;
  mode: PdfTranslationOutputMode;
  ignoreCache?: boolean;
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
  translatedMonoPdfPath?: string;
  translatedMonoPdfName?: string;
  translatedPdfMode?: PdfTranslationOutputMode;
  translationEngine?: PdfTranslationEngine;
  translationSourceHash?: string;
  translatedAt?: string;
  translatedProvider?: string;
  translatedModel?: string;
}

export function findReusablePdfTranslationRecord<T extends PdfTranslationRecordFields>(
  records: T[],
  input: {
    sourceHash: string;
    outputMode: PdfTranslationOutputMode;
  }
): T | null {
  return records.find((record) =>
    record.translationSourceHash === input.sourceHash &&
    record.translatedPdfMode === input.outputMode &&
    Boolean(record.translatedPdfPath)
  ) ?? null;
}

export function normalizePdfTranslationRecordFields<T extends PdfTranslationRecordFields>(record: T): T {
  return {
    ...record,
    translatedPdfName: record.translatedPdfName || getOptionalPdfBaseName(record.translatedPdfPath),
    translatedMonoPdfName:
      record.translatedMonoPdfName || getOptionalPdfBaseName(record.translatedMonoPdfPath)
  };
}

export function buildPdf2zhCommand(input: PdfTranslationCommandInput): PdfTranslationCommand {
  const args =
    input.invocation === 'python-module'
      ? ['-m', 'pdf2zh.pdf2zh']
      : [];

  args.push(
    input.pdfPath,
    '-s',
    'openai',
    '-li',
    'en',
    '-lo',
    'zh',
    '-o',
    input.outputDir,
    '-t',
    '1'
  );

  if (input.ignoreCache) {
    args.push('--ignore-cache');
  }

  const runtimeOptions = resolveAiRuntimeOptions(input.settings);
  const disableKimiThinking = isKimiK2Model(input.settings) && runtimeOptions.thinkingMode !== 'enabled';
  const pdfTranslationTemperature =
    !isKimiK2Model(input.settings) && input.settings.temperature === undefined
      ? 0
      : runtimeOptions.temperature;

  return {
    command: input.executable,
    args,
    env: {
      OPENAI_BASE_URL: input.settings.baseURL.replace(/\/+$/u, ''),
      OPENAI_MODEL: input.settings.model,
      PDF_TRANSLATION_READER_OPENAI_TEMPERATURE: String(pdfTranslationTemperature),
      PDF_TRANSLATION_READER_DISABLE_THINKING: disableKimiThinking ? '1' : '0',
      PDF_TRANSLATION_READER_OPENAI_TIMEOUT: String(runtimeOptions.timeoutSeconds),
      PDF_TRANSLATION_READER_OPENAI_MAX_RETRIES: String(runtimeOptions.maxRetries)
    }
  };
}

export function patchPdf2zhOpenAiTemperatureSource(source: string): { source: string; changed: boolean } {
  const openAiClassStart = source.indexOf('class OpenAITranslator');
  if (openAiClassStart < 0) {
    return { source, changed: false };
  }

  const nextClassStart = source.indexOf('\nclass ', openAiClassStart + 1);
  const openAiClassEnd = nextClassStart > openAiClassStart ? nextClassStart : source.length;
  const before = source.slice(0, openAiClassStart);
  const openAiClass = source.slice(openAiClassStart, openAiClassEnd);
  const after = source.slice(openAiClassEnd);

  let patchedClass = openAiClass.replace(
    /^(\s*)self\.options\s*=\s*\{"temperature":\s*(?:0|float\(os\.environ\.get\("PDF_TRANSLATION_READER_OPENAI_TEMPERATURE", "0"\)\))\}[^\n]*(?:\n\1if os\.environ\.get\("PDF_TRANSLATION_READER_DISABLE_THINKING", "0"\) == "1":\n\1    self\.options\["extra_body"\] = \{"thinking": \{"type": "disabled"\}\})*/mu,
    [
      '$1self.options = {"temperature": float(os.environ.get("PDF_TRANSLATION_READER_OPENAI_TEMPERATURE", "0"))}  # App runtime patch: provider-specific temperature',
      '$1if os.environ.get("PDF_TRANSLATION_READER_DISABLE_THINKING", "0") == "1":',
      '$1    self.options["extra_body"] = {"thinking": {"type": "disabled"}}'
    ].join('\n')
  );

  if (!patchedClass.includes('PDF_TRANSLATION_READER_OPENAI_TIMEOUT')) {
    patchedClass = patchedClass
      .replace(
        /(api_key=api_key or self\.envs\["OPENAI_API_KEY"\],\n)(\s*\))/u,
        [
          '$1',
          '            timeout=float(os.environ.get("PDF_TRANSLATION_READER_OPENAI_TIMEOUT", "120")),',
          '            max_retries=int(os.environ.get("PDF_TRANSLATION_READER_OPENAI_MAX_RETRIES", "1")),',
          '$2'
        ].join('\n')
      )
      .replace(
        /openai\.OpenAI\(\)/u,
        'openai.OpenAI(timeout=float(os.environ.get("PDF_TRANSLATION_READER_OPENAI_TIMEOUT", "120")), max_retries=int(os.environ.get("PDF_TRANSLATION_READER_OPENAI_MAX_RETRIES", "1")))'
      );
  }

  if (patchedClass === openAiClass) {
    return { source, changed: false };
  }

  return {
    source: `${before}${patchedClass}${after}`,
    changed: true
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

export function formatPdfTranslationProgressMessage(value: string): string {
  const lines = value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '')
    .replace(/\r/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const cleaned = lines.at(-1);

  if (!cleaned) {
    return '';
  }

  const normalized = lines.join('\n').toLowerCase();
  if (normalized.includes('content_filter')) {
    return 'PDF 翻译被模型内容安全策略拦截（content_filter）。建议换用更适合长文档翻译的模型，或关闭思考模式后重新生成。';
  }

  if (normalized.includes('invalid temperature')) {
    return '当前模型限制 temperature 参数。请在 PDF 翻译 API 高级选项中使用该模型允许的数值，例如 Kimi K2.5 非思考模式通常为 0.6。';
  }

  const tqdmMatch = cleaned.match(/(\d{1,3})%\|.*?\|\s*(\d+)\s*\/\s*(\d+)/u);
  if (tqdmMatch) {
    const percent = Math.min(100, Math.max(0, Number(tqdmMatch[1])));
    return `PDF 翻译进度：${percent}%，${tqdmMatch[2]}/${tqdmMatch[3]} 页`;
  }

  return cleaned.replace(/\s+/gu, ' ');
}

function getFileStem(filePath: string): string {
  const fileName = filePath.replace(/\\/gu, '/').split('/').pop() || 'translated';
  return fileName.replace(/\.[^.]+$/u, '') || 'translated';
}

function getOptionalPdfBaseName(filePath?: string): string | undefined {
  return filePath?.replace(/\\/gu, '/').split('/').pop() || undefined;
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
