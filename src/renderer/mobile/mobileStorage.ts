import { Capacitor } from '@capacitor/core';
import { FileTransfer } from '@capacitor/file-transfer';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import {
  parseMobileLibrary,
  parseTranslationEntries,
  sanitizeFileName,
  type MobilePaper,
  type MobilePdfKind,
  type MobileStoredPdf,
  type MobileTranslationEntry
} from './mobileTypes';

const MOBILE_LIBRARY_KEY = 'pdfTranslationReader:mobileLibrary:v1';
const MOBILE_TRANSLATION_PREFERENCES_KEY = 'pdfTranslationReader:mobileTranslationPreferences:v1';

export async function loadMobileLibrary(): Promise<MobilePaper[]> {
  const { value } = await Preferences.get({ key: MOBILE_LIBRARY_KEY });
  return parseMobileLibrary(value);
}

export async function saveMobileLibrary(library: MobilePaper[]): Promise<void> {
  await Preferences.set({ key: MOBILE_LIBRARY_KEY, value: JSON.stringify(library) });
}

export async function savePdfBytes(input: {
  paperId: string;
  fileName: string;
  kind: MobilePdfKind;
  bytes: Uint8Array;
}): Promise<MobileStoredPdf> {
  const fileName = ensurePdfExtension(sanitizeFileName(input.fileName));
  const path = buildPdfPath(input.paperId, input.kind, fileName);
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data: uint8ArrayToBase64(input.bytes),
    recursive: true
  });
  return { path, fileName, kind: input.kind, byteLength: input.bytes.byteLength };
}

export async function savePdfFile(input: {
  paperId: string;
  file: File;
  kind: MobilePdfKind;
}): Promise<MobileStoredPdf> {
  return savePdfBytes({
    paperId: input.paperId,
    fileName: input.file.name,
    kind: input.kind,
    bytes: new Uint8Array(await input.file.arrayBuffer())
  });
}

export async function downloadPdfFile(input: {
  paperId: string;
  url: string;
  fileName: string;
}): Promise<MobileStoredPdf> {
  const fileName = ensurePdfExtension(sanitizeFileName(input.fileName));
  const path = buildPdfPath(input.paperId, 'source', fileName);

  if (Capacitor.isNativePlatform()) {
    await Filesystem.mkdir({ path: `papers/${input.paperId}/source`, directory: Directory.Data, recursive: true });
    const destination = await Filesystem.getUri({ path, directory: Directory.Data });
    await FileTransfer.downloadFile({ url: input.url, path: destination.uri });
    const stat = await Filesystem.stat({ path, directory: Directory.Data });
    return { path, fileName, kind: 'source', byteLength: Number(stat.size) || 0 };
  }

  const response = await fetch(input.url);
  if (!response.ok) {
    throw new Error(`PDF 下载失败：HTTP ${response.status}`);
  }
  return savePdfBytes({
    paperId: input.paperId,
    fileName,
    kind: 'source',
    bytes: new Uint8Array(await response.arrayBuffer())
  });
}

export async function readPdfBytes(pdf: MobileStoredPdf): Promise<Uint8Array> {
  const result = await Filesystem.readFile({ path: pdf.path, directory: Directory.Data });
  if (typeof result.data === 'string') {
    return base64ToUint8Array(result.data);
  }
  return new Uint8Array(await result.data.arrayBuffer());
}

export async function removeStoredPaper(paperId: string): Promise<void> {
  try {
    await Filesystem.rmdir({ path: `papers/${paperId}`, directory: Directory.Data, recursive: true });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

export async function loadPaperTranslations(paperId: string): Promise<MobileTranslationEntry[]> {
  try {
    const result = await Filesystem.readFile({
      path: buildTranslationPath(paperId),
      directory: Directory.Data,
      encoding: Encoding.UTF8
    });
    return parseTranslationEntries(typeof result.data === 'string' ? result.data : await result.data.text());
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

export async function savePaperTranslations(
  paperId: string,
  entries: MobileTranslationEntry[]
): Promise<void> {
  await Filesystem.writeFile({
    path: buildTranslationPath(paperId),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(entries),
    recursive: true
  });
}

export async function loadTranslationPreferences(): Promise<{ baseURL: string; model: string }> {
  const defaults = { baseURL: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' };
  const { value } = await Preferences.get({ key: MOBILE_TRANSLATION_PREFERENCES_KEY });
  if (!value) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(value) as Partial<typeof defaults>;
    return {
      baseURL: typeof parsed.baseURL === 'string' && parsed.baseURL.trim() ? parsed.baseURL : defaults.baseURL,
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : defaults.model
    };
  } catch {
    return defaults;
  }
}

export async function saveTranslationPreferences(value: { baseURL: string; model: string }): Promise<void> {
  await Preferences.set({
    key: MOBILE_TRANSLATION_PREFERENCES_KEY,
    value: JSON.stringify({ baseURL: value.baseURL.trim(), model: value.model.trim() })
  });
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return window.btoa(binary);
}

export function base64ToUint8Array(value: string): Uint8Array {
  const normalized = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = window.atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function buildPdfPath(paperId: string, kind: MobilePdfKind, fileName: string): string {
  return `papers/${paperId}/${kind}/${fileName}`;
}

function buildTranslationPath(paperId: string): string {
  return `papers/${paperId}/translations/cache.json`;
}

function ensurePdfExtension(value: string): string {
  return value.toLowerCase().endsWith('.pdf') ? value : `${value}.pdf`;
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not exist|not found|does not exist|ENOENT/iu.test(message);
}
