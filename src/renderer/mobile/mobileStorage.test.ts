import { describe, expect, it } from 'vitest';
import {
  MAX_MOBILE_PDF_BYTES,
  assertMobilePdfByteLength,
  copyPdfBytesForIndexedDb,
  createMobileLibraryWriteQueue,
  formatMobilePdfDownloadHttpError,
  parseMobileTranslationPreferences,
  readMobilePdfResponse,
  serializeMobileTranslationPreferences,
  validateMobilePdfHeader
} from './mobileStorage';
import { createImportedMobilePaper, type MobileStoredPdf } from './mobileTypes';

describe('mobile PDF storage guards', () => {
  it('serializes library writes and coalesces snapshots that have not started yet', async () => {
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const writes: string[] = [];
    const sourcePdf: MobileStoredPdf = {
      path: 'papers/source/paper.pdf',
      fileName: 'paper.pdf',
      kind: 'source',
      byteLength: 120
    };
    const firstPaper = createImportedMobilePaper({ id: 'first', fileName: 'first.pdf', storedPdf: sourcePdf });
    const middlePaper = createImportedMobilePaper({ id: 'middle', fileName: 'middle.pdf', storedPdf: sourcePdf });
    const latestPaper = createImportedMobilePaper({ id: 'latest', fileName: 'latest.pdf', storedPdf: sourcePdf });
    const write = createMobileLibraryWriteQueue(async (library) => {
      writes.push(library[0]?.id ?? 'empty');
      if (writes.length === 1) {
        markFirstStarted?.();
        await firstBlocked;
      }
    });

    const first = write([firstPaper]);
    const middle = write([middlePaper]);
    const latest = write([latestPaper]);
    await firstStarted;
    expect(writes).toEqual(['first']);
    releaseFirst?.();
    await Promise.all([first, middle, latest]);
    expect(writes).toEqual(['first', 'latest']);
  });

  it('accepts a PDF signature within the mobile size limit', () => {
    expect(() => assertMobilePdfByteLength(1024)).not.toThrow();
    expect(() => validateMobilePdfHeader(new TextEncoder().encode('%PDF-1.7\n'))).not.toThrow();
  });

  it('rejects empty, oversized, and non-PDF payloads before persistence', () => {
    expect(() => assertMobilePdfByteLength(0)).toThrow('不能为空');
    expect(() => assertMobilePdfByteLength(MAX_MOBILE_PDF_BYTES + 1)).toThrow('过大');
    expect(() => validateMobilePdfHeader(new TextEncoder().encode('<html>error</html>'))).toThrow('有效的 PDF');
  });

  it('rejects non-PDF responses and accepts streamed PDF bytes', async () => {
    await expect(readMobilePdfResponse(new Response('<html>error</html>', {
      headers: { 'Content-Type': 'text/html' }
    }))).rejects.toThrow('没有返回 PDF');

    const bytes = await readMobilePdfResponse(new Response('%PDF-1.7\nbody', {
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': '13' }
    }));
    expect(new TextDecoder().decode(bytes)).toBe('%PDF-1.7\nbody');
  });

  it('persists web PDFs as raw ArrayBuffer data instead of Safari-incompatible Blob values', () => {
    const source = new Uint8Array([37, 80, 68, 70, 45]);
    const stored = copyPdfBytesForIndexedDb(source);
    source[0] = 0;
    expect(stored).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(stored))).toEqual([37, 80, 68, 70, 45]);
  });

  it('explains arXiv PDF availability and rate-limit errors instead of showing a bare status', () => {
    expect(formatMobilePdfDownloadHttpError(404)).toContain('PDF 暂未开放');
    expect(formatMobilePdfDownloadHttpError(429)).toContain('请求过于频繁');
    expect(formatMobilePdfDownloadHttpError(500)).toBe('PDF 下载失败：HTTP 500');
  });

  it('persists the API key with the local translation endpoint settings', () => {
    const serialized = serializeMobileTranslationPreferences({
      baseURL: ' https://api.deepseek.com/v1/ ',
      model: ' deepseek-chat ',
      apiKey: ' sk-local-only '
    });
    expect(JSON.parse(serialized)).toEqual({
      baseURL: 'https://api.deepseek.com/v1/',
      model: 'deepseek-chat',
      apiKey: 'sk-local-only'
    });
    expect(parseMobileTranslationPreferences(serialized)).toEqual({
      baseURL: 'https://api.deepseek.com/v1/',
      model: 'deepseek-chat',
      apiKey: 'sk-local-only'
    });
  });

  it('recovers safe defaults from an old or malformed translation preference record', () => {
    expect(parseMobileTranslationPreferences(JSON.stringify({
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    }))).toEqual({
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: ''
    });
    expect(parseMobileTranslationPreferences('{bad')).toEqual({
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: ''
    });
  });
});
