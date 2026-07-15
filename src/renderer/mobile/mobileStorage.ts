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
import { buildMobileWebPdfUrl } from './mobileWeb';
import { validatePdfDocumentData } from '../lib/pdfOutlineExtraction';

const MOBILE_LIBRARY_KEY = 'pdfTranslationReader:mobileLibrary:v1';
const MOBILE_TRANSLATION_PREFERENCES_KEY = 'pdfTranslationReader:mobileTranslationPreferences:v1';
const MOBILE_PDF_DATABASE_NAME = 'pdfTranslationReader:mobilePdfFiles:v1';
const MOBILE_PDF_OBJECT_STORE = 'pdfFiles';
export const MAX_MOBILE_PDF_BYTES = 64 * 1024 * 1024;
const MOBILE_PDF_DOWNLOAD_TIMEOUT_MS = 45_000;

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
  assertMobilePdfByteLength(input.bytes.byteLength);
  validateMobilePdfHeader(input.bytes);
  await validatePdfDocumentData(input.bytes);
  const fileName = ensurePdfExtension(sanitizeFileName(input.fileName));
  const path = buildPdfPath(input.paperId, input.kind, fileName);
  const contentHash = await hashPdfBytes(input.bytes);
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      data: uint8ArrayToBase64(input.bytes),
      recursive: true
    });
  } else {
    await writeWebPdfBytes(path, input.bytes);
  }
  return {
    path,
    fileName,
    kind: input.kind,
    byteLength: input.bytes.byteLength,
    contentHash
  };
}

export async function savePdfFile(input: {
  paperId: string;
  file: File;
  kind: MobilePdfKind;
}): Promise<MobileStoredPdf> {
  assertMobilePdfByteLength(input.file.size);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  validateMobilePdfHeader(bytes);
  return savePdfBytes({
    paperId: input.paperId,
    fileName: input.file.name,
    kind: input.kind,
    bytes
  });
}

export async function downloadPdfFile(input: {
  paperId: string;
  url: string;
  fileName: string;
  signal?: AbortSignal;
}): Promise<MobileStoredPdf> {
  const fileName = ensurePdfExtension(sanitizeFileName(input.fileName));
  const path = buildPdfPath(input.paperId, 'source', fileName);

  if (Capacitor.isNativePlatform()) {
    throwIfAborted(input.signal);
    await Filesystem.mkdir({ path: `papers/${input.paperId}/source`, directory: Directory.Data, recursive: true });
    const destination = await Filesystem.getUri({ path, directory: Directory.Data });
    await FileTransfer.downloadFile({
      url: input.url,
      path: destination.uri,
      connectTimeout: 15_000,
      readTimeout: MOBILE_PDF_DOWNLOAD_TIMEOUT_MS
    });
    if (input.signal?.aborted) {
      await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
      throwIfAborted(input.signal);
    }
    const stat = await Filesystem.stat({ path, directory: Directory.Data });
    const byteLength = Number(stat.size) || 0;
    try {
      assertMobilePdfByteLength(byteLength);
      const storedPdf: MobileStoredPdf = { path, fileName, kind: 'source', byteLength };
      const bytes = await readPdfBytes(storedPdf);
      validateMobilePdfHeader(bytes);
      await validatePdfDocumentData(bytes);
      storedPdf.contentHash = await hashPdfBytes(bytes);
      return storedPdf;
    } catch (error) {
      await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
      throw error;
    }
  }

  const bytes = await fetchMobilePdfBytes(buildMobileWebPdfUrl(input.url), input.signal);
  return savePdfBytes({
    paperId: input.paperId,
    fileName,
    kind: 'source',
    bytes
  });
}

export async function readPdfBytes(pdf: MobileStoredPdf): Promise<Uint8Array> {
  if (!Capacitor.isNativePlatform()) {
    const storedBytes = await readWebPdfBytes(pdf.path);
    if (storedBytes) {
      return storedBytes;
    }
  }
  const result = await Filesystem.readFile({ path: pdf.path, directory: Directory.Data });
  if (typeof result.data === 'string') {
    return base64ToUint8Array(result.data);
  }
  return new Uint8Array(await result.data.arrayBuffer());
}

export async function removeStoredPaper(paperId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await deleteWebPdfPrefix(`papers/${paperId}/`);
  }
  try {
    await Filesystem.rmdir({ path: `papers/${paperId}`, directory: Directory.Data, recursive: true });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

export async function removeStoredPdfFile(pdf: MobileStoredPdf): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await deleteWebPdfPath(pdf.path);
  }
  try {
    await Filesystem.deleteFile({ path: pdf.path, directory: Directory.Data });
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

export function copyPdfBytesForIndexedDb(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

async function writeWebPdfBytes(path: string, bytes: Uint8Array): Promise<void> {
  const database = await openMobilePdfDatabase();
  try {
    await completeIndexedDbTransaction(database, 'readwrite', (store) => {
      store.put(copyPdfBytesForIndexedDb(bytes), path);
    });
  } finally {
    database.close();
  }
}

async function readWebPdfBytes(path: string): Promise<Uint8Array | null> {
  const database = await openMobilePdfDatabase();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_PDF_OBJECT_STORE, 'readonly');
      const request = transaction.objectStore(MOBILE_PDF_OBJECT_STORE).get(path);
      request.onsuccess = () => {
        const value = request.result as ArrayBuffer | ArrayBufferView | undefined;
        if (value instanceof ArrayBuffer) {
          resolve(new Uint8Array(value));
        } else if (ArrayBuffer.isView(value)) {
          resolve(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('读取网页 PDF 存储失败。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('读取网页 PDF 存储失败。'));
    });
  } finally {
    database.close();
  }
}

async function deleteWebPdfPath(path: string): Promise<void> {
  const database = await openMobilePdfDatabase();
  try {
    await completeIndexedDbTransaction(database, 'readwrite', (store) => {
      store.delete(path);
    });
  } finally {
    database.close();
  }
}

async function deleteWebPdfPrefix(prefix: string): Promise<void> {
  const database = await openMobilePdfDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_PDF_OBJECT_STORE, 'readwrite');
      const request = transaction.objectStore(MOBILE_PDF_OBJECT_STORE).openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('清理网页 PDF 存储失败。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('清理网页 PDF 存储失败。'));
    });
  } finally {
    database.close();
  }
}

function openMobilePdfDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MOBILE_PDF_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MOBILE_PDF_OBJECT_STORE)) {
        request.result.createObjectStore(MOBILE_PDF_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开网页 PDF 存储失败。'));
    request.onblocked = () => reject(new Error('网页 PDF 存储被其它页面占用，请关闭其它标签页后重试。'));
  });
}

function completeIndexedDbTransaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MOBILE_PDF_OBJECT_STORE, mode);
    operation(transaction.objectStore(MOBILE_PDF_OBJECT_STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('写入网页 PDF 存储失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('写入网页 PDF 存储失败。'));
  });
}

export function assertMobilePdfByteLength(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new Error('PDF 文件不能为空。');
  }
  if (byteLength > MAX_MOBILE_PDF_BYTES) {
    throw new Error(`PDF 文件过大；手机版当前最多支持 ${formatMegabytes(MAX_MOBILE_PDF_BYTES)} MB。`);
  }
}

export function validateMobilePdfHeader(bytes: Uint8Array): void {
  const signature = String.fromCharCode(...bytes.subarray(0, 5));
  if (signature !== '%PDF-') {
    throw new Error('文件不是有效的 PDF，已取消写入论文库。');
  }
}

async function fetchMobilePdfBytes(url: string, externalSignal?: AbortSignal): Promise<Uint8Array> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    throw new Error('PDF 下载已取消。');
  }
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MOBILE_PDF_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`PDF 下载失败：HTTP ${response.status}`);
    }
    return await readMobilePdfResponse(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timedOut ? 'PDF 下载超时，请检查网络后重试。' : 'PDF 下载已取消。');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export async function readMobilePdfResponse(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > 0) {
    assertMobilePdfByteLength(declaredLength);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (contentType && contentType !== 'application/pdf' && contentType !== 'application/octet-stream') {
    throw new Error(`下载地址没有返回 PDF（Content-Type: ${contentType}）。`);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertMobilePdfByteLength(bytes.byteLength);
    validateMobilePdfHeader(bytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      assertMobilePdfByteLength(total);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  validateMobilePdfHeader(bytes);
  return bytes;
}

async function hashPdfBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
    return `sha256-${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('PDF 下载已取消。');
  }
}

function formatMegabytes(byteLength: number): string {
  return Math.round(byteLength / (1024 * 1024)).toString();
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
