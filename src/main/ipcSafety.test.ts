import { describe, expect, it } from 'vitest';
import {
  assertAllowedExtension,
  assertMaxBytes,
  normalizeSafeFilePath,
  parseSafeExternalUrl
} from './ipcSafety';

describe('ipcSafety', () => {
  it('allows only known arXiv HTTPS external links', () => {
    expect(parseSafeExternalUrl('https://arxiv.org/abs/2606.00001')).toBe('https://arxiv.org/abs/2606.00001');
    expect(parseSafeExternalUrl('https://www.arxiv.org/pdf/2606.00001.pdf')).toBe(
      'https://www.arxiv.org/pdf/2606.00001.pdf'
    );

    expect(() => parseSafeExternalUrl('javascript:alert(1)')).toThrow(/external URL/i);
    expect(() => parseSafeExternalUrl('http://arxiv.org/abs/2606.00001')).toThrow(/external URL/i);
    expect(() => parseSafeExternalUrl('https://arxiv.org.evil.test/abs/2606.00001')).toThrow(/external URL/i);
  });

  it('rejects empty and null-byte file paths from renderer IPC', () => {
    expect(normalizeSafeFilePath(' C:\\papers\\demo.pdf ')).toBe('C:\\papers\\demo.pdf');
    expect(() => normalizeSafeFilePath('')).toThrow(/file path/i);
    expect(() => normalizeSafeFilePath('C:\\papers\\bad\u0000.pdf')).toThrow(/file path/i);
  });

  it('validates file extensions case-insensitively', () => {
    expect(assertAllowedExtension('paper.PDF', ['.pdf'])).toBeUndefined();
    expect(assertAllowedExtension('translation.markdown', ['.md', '.markdown'])).toBeUndefined();
    expect(() => assertAllowedExtension('payload.exe', ['.json'])).toThrow(/file type/i);
  });

  it('bounds renderer-provided content sizes before writing files', () => {
    expect(assertMaxBytes(1024, 1024, 'text')).toBeUndefined();
    expect(() => assertMaxBytes(1025, 1024, 'text')).toThrow(/too large/i);
  });
});
