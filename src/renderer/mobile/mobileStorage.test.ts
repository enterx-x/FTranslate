import { describe, expect, it } from 'vitest';
import {
  MAX_MOBILE_PDF_BYTES,
  assertMobilePdfByteLength,
  copyPdfBytesForIndexedDb,
  readMobilePdfResponse,
  validateMobilePdfHeader
} from './mobileStorage';

describe('mobile PDF storage guards', () => {
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
});
