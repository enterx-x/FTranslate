import { describe, expect, it } from 'vitest';
import {
  buildPdf2zhCommand,
  buildPdfTranslationOutputPaths,
  buildPdfTranslationSourceHash,
  patchPdf2zhOpenAiTemperatureSource,
  sanitizePdfTranslationLog
} from './pdfTranslation';

describe('PDFMathTranslate command helpers', () => {
  it('builds a pdf2zh command for dual PDF output without exposing the API key', () => {
    const command = buildPdf2zhCommand({
      executable: 'pdf2zh',
      pdfPath: 'D:/papers/robot paper.pdf',
      outputDir: 'C:/Users/me/AppData/Roaming/PDF Translation Reader/translations/paper-1',
      mode: 'dual',
      settings: {
        provider: 'kimi',
        baseURL: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.5'
      }
    });

    expect(command.command).toBe('pdf2zh');
    expect(command.args).toEqual(
      expect.arrayContaining([
        'D:/papers/robot paper.pdf',
        '-s',
        'openai',
        '-li',
        'en',
        '-lo',
        'zh',
        '-o',
        'C:/Users/me/AppData/Roaming/PDF Translation Reader/translations/paper-1'
      ])
    );
    expect(command.args).not.toContain('--no-mono');
    expect(command.args).not.toContain('--no-dual');
    expect(command.env.OPENAI_BASE_URL).toBe('https://api.moonshot.cn/v1');
    expect(command.env.OPENAI_MODEL).toBe('kimi-k2.5');
    expect(command.env.PDF_TRANSLATION_READER_OPENAI_TEMPERATURE).toBe('1');
    expect(command.args.join(' ')).not.toContain('sk-');
  });

  it('keeps non-Kimi pdf2zh translations deterministic when the runtime patch is available', () => {
    const command = buildPdf2zhCommand({
      executable: 'pdf2zh',
      pdfPath: 'D:/papers/robot paper.pdf',
      outputDir: 'C:/cache',
      mode: 'dual',
      settings: {
        provider: 'openai',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-5'
      }
    });

    expect(command.env.PDF_TRANSLATION_READER_OPENAI_TEMPERATURE).toBe('0');
  });

  it('can invoke pdf2zh as a Python module from the app private venv', () => {
    const command = buildPdf2zhCommand({
      executable: 'C:/app/sidecars/pdf2zh-venv/Scripts/python.exe',
      invocation: 'python-module',
      pdfPath: 'D:/papers/robot paper.pdf',
      outputDir: 'C:/cache',
      mode: 'dual',
      settings: {
        provider: 'openai',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-5.5'
      }
    });

    expect(command.command).toBe('C:/app/sidecars/pdf2zh-venv/Scripts/python.exe');
    expect(command.args.slice(0, 2)).toEqual(['-m', 'pdf2zh.pdf2zh']);
    expect(command.args).toContain('D:/papers/robot paper.pdf');
  });

  it('does not pass version-specific output suppression flags for mono mode', () => {
    const command = buildPdf2zhCommand({
      executable: 'pdf2zh',
      pdfPath: 'D:/papers/robot paper.pdf',
      outputDir: 'C:/cache',
      mode: 'mono',
      settings: {
        provider: 'kimi',
        baseURL: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.5'
      }
    });

    expect(command.args).not.toContain('--no-mono');
    expect(command.args).not.toContain('--no-dual');
  });

  it('patches the OpenAI translator temperature even if another translator was patched before', () => {
    const source = [
      'class XinferenceTranslator(BaseTranslator):',
      '    def __init__(self):',
      '        self.options = {"temperature": float(os.environ.get("PDF_TRANSLATION_READER_OPENAI_TEMPERATURE", "0"))}',
      '',
      'class OpenAITranslator(BaseTranslator):',
      '    def __init__(self):',
      '        self.options = {"temperature": 0}  # 随机采样可能会打断公式标记',
      '        self.client = openai.OpenAI()',
      '',
      'class AzureOpenAITranslator(BaseTranslator):',
      '    def __init__(self):',
      '        self.options = {"temperature": 0}'
    ].join('\n');

    const patched = patchPdf2zhOpenAiTemperatureSource(source);

    expect(patched.changed).toBe(true);
    expect(patched.source).toContain(
      'class OpenAITranslator(BaseTranslator):\n    def __init__(self):\n        self.options = {"temperature": float(os.environ.get("PDF_TRANSLATION_READER_OPENAI_TEMPERATURE", "0"))}'
    );
    expect(patched.source).toContain('class AzureOpenAITranslator(BaseTranslator):');
    expect(patched.source).toContain('        self.options = {"temperature": 0}');
  });

  it('derives stable dual and mono output paths from the source PDF name', () => {
    const output = buildPdfTranslationOutputPaths({
      pdfPath: 'D:/papers/2604.15483v2.pdf',
      outputDir: 'D:/cache'
    });

    expect(output.dualPdfPath).toBe('D:/cache/2604.15483v2-dual.pdf');
    expect(output.monoPdfPath).toBe('D:/cache/2604.15483v2-mono.pdf');
  });

  it('hashes source identity and redacts secrets from process logs', () => {
    expect(
      buildPdfTranslationSourceHash({
        pdfPath: 'D:/paper.pdf',
        fileSize: 123,
        mtimeMs: 456
      })
    ).toBe(
      buildPdfTranslationSourceHash({
        pdfPath: 'd:\\PAPER.pdf',
        fileSize: 123,
        mtimeMs: 456
      })
    );

    expect(
      buildPdfTranslationSourceHash({
        pdfPath: 'D:/paper.pdf',
        fileSize: 123,
        mtimeMs: 456
      })
    ).not.toBe(
      buildPdfTranslationSourceHash({
        pdfPath: 'D:/paper.pdf',
        fileSize: 124,
        mtimeMs: 456
      })
    );

    expect(sanitizePdfTranslationLog('failed with sk-secret-token', 'sk-secret-token')).toBe(
      'failed with [REDACTED_API_KEY]'
    );
  });
});
