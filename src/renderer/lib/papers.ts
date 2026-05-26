import type { TranslationDocument } from './translation';

export const PAPER_LIBRARY_KEY = 'pdfTranslationReader:paperLibrary';

export interface PaperRecord {
  id: string;
  pdfPath: string;
  pdfName: string;
  translationPath: string;
  translationName: string;
  chineseTitle: string;
  englishTitle: string;
  journal: string;
  authors: string;
  year: string;
  lastOpenedAt: string;
  lastPage: number;
}

interface BuildPaperRecordInput {
  pdfPath: string;
  pdfName: string;
  translationPath: string;
  translationName: string;
  document: TranslationDocument;
  now?: string;
  lastPage?: number;
}

export function buildPaperRecord(input: BuildPaperRecordInput): PaperRecord {
  const firstTranslation = getFirstTranslationText(input.document);
  const metadata = input.document.metadata ?? {};

  return {
    id: createPaperId(input.pdfPath, input.translationPath),
    pdfPath: input.pdfPath,
    pdfName: input.pdfName,
    translationPath: input.translationPath,
    translationName: input.translationName,
    chineseTitle: metadata.chineseTitle || truncateText(firstTranslation, 40) || input.translationName,
    englishTitle: metadata.englishTitle || stripExtension(input.pdfName),
    journal: metadata.journal || '',
    authors: metadata.authors || '',
    year: metadata.year || '',
    lastOpenedAt: input.now ?? new Date().toISOString(),
    lastPage: input.lastPage ?? 1
  };
}

export function upsertPaperRecord(library: PaperRecord[], incoming: PaperRecord): PaperRecord[] {
  const existingIndex = library.findIndex(
    (record) =>
      record.pdfPath === incoming.pdfPath && record.translationPath === incoming.translationPath
  );

  if (existingIndex < 0) {
    return [incoming, ...library];
  }

  const existing = library[existingIndex];
  const merged: PaperRecord = {
    ...incoming,
    chineseTitle: existing.chineseTitle || incoming.chineseTitle,
    englishTitle: existing.englishTitle || incoming.englishTitle,
    journal: existing.journal || incoming.journal,
    authors: existing.authors || incoming.authors,
    year: existing.year || incoming.year,
    lastPage: existing.lastPage || incoming.lastPage
  };

  return [merged, ...library.filter((_, index) => index !== existingIndex)];
}

export function updatePaperRecord(
  record: PaperRecord,
  updates: Partial<
    Pick<
      PaperRecord,
      | 'translationPath'
      | 'translationName'
      | 'chineseTitle'
      | 'englishTitle'
      | 'journal'
      | 'authors'
      | 'year'
      | 'lastOpenedAt'
      | 'lastPage'
    >
  >
): PaperRecord {
  return {
    ...record,
    ...updates,
    lastPage: Math.max(1, Number(updates.lastPage ?? record.lastPage) || 1)
  };
}

export function parsePaperLibrary(value: string | null): PaperRecord[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizePaperRecord(item))
      .filter((item): item is PaperRecord => Boolean(item));
  } catch {
    return [];
  }
}

export function serializePaperLibrary(library: PaperRecord[]): string {
  return JSON.stringify(library, null, 2);
}

function normalizePaperRecord(value: unknown): PaperRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const pdfPath = toText(record.pdfPath);
  const translationPath = toText(record.translationPath);

  if (!pdfPath || !translationPath) {
    return null;
  }

  return {
    id: toText(record.id) || createPaperId(pdfPath, translationPath),
    pdfPath,
    pdfName: toText(record.pdfName) || stripExtension(pdfPath),
    translationPath,
    translationName: toText(record.translationName) || stripExtension(translationPath),
    chineseTitle: toText(record.chineseTitle),
    englishTitle: toText(record.englishTitle) || stripExtension(toText(record.pdfName) || pdfPath),
    journal: toText(record.journal),
    authors: toText(record.authors),
    year: toText(record.year),
    lastOpenedAt: toText(record.lastOpenedAt) || new Date().toISOString(),
    lastPage: Math.max(1, Number(record.lastPage) || 1)
  };
}

function getFirstTranslationText(document: TranslationDocument): string {
  return document.items.find((item) => item.translation.trim())?.translation ?? '';
}

function stripExtension(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  return normalized.replace(/\.[^.]+$/, '');
}

function createPaperId(pdfPath: string, translationPath: string): string {
  return `paper-${hashString(`${pdfPath}|${translationPath}`)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
