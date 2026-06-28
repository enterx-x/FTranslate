import fs from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_EXTERNAL_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);

export function parseSafeExternalUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Unsafe external URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Unsafe external URL.');
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Unsafe external URL.');
  }

  return parsed.href;
}

export function normalizeSafeFilePath(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid file path.');
  }

  const filePath = value.trim();
  if (!filePath || filePath.includes('\u0000')) {
    throw new Error('Invalid file path.');
  }

  return filePath;
}

export function assertAllowedExtension(filePath: string, allowedExtensions: string[]): void {
  const normalizedExtensions = allowedExtensions.map((extension) => extension.toLowerCase());
  const extension = path.extname(filePath).toLowerCase();
  if (!normalizedExtensions.includes(extension)) {
    throw new Error(`Unsupported file type: ${extension || '(none)'}.`);
  }
}

export function assertMaxBytes(byteLength: number, maxBytes: number, label: string): void {
  if (!Number.isFinite(byteLength) || byteLength < 0 || byteLength > maxBytes) {
    throw new Error(`${label} is too large.`);
  }
}

export function assertTextContentSize(content: unknown, maxBytes: number, label: string): string {
  if (typeof content !== 'string') {
    throw new Error(`${label} content is invalid.`);
  }
  assertMaxBytes(Buffer.byteLength(content, 'utf8'), maxBytes, label);
  return content;
}

export function assertBase64ContentSize(contentBase64: unknown, maxBytes: number, label: string): string {
  if (typeof contentBase64 !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/u.test(contentBase64)) {
    throw new Error(`${label} content is invalid.`);
  }
  assertMaxBytes(Buffer.byteLength(contentBase64.replace(/\s+/gu, ''), 'base64'), maxBytes, label);
  return contentBase64;
}

export async function assertReadableFilePath(
  value: unknown,
  allowedExtensions: string[],
  maxBytes: number
): Promise<string> {
  const filePath = normalizeSafeFilePath(value);
  assertAllowedExtension(filePath, allowedExtensions);
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error('Invalid file path.');
  }
  assertMaxBytes(stats.size, maxBytes, 'file');
  return filePath;
}
