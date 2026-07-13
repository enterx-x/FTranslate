import type { ArxivPaper } from '../../shared/arxiv';

export type MobilePaperSource = 'import' | 'arxiv';
export type MobilePdfKind = 'source' | 'translated';

export interface MobileStoredPdf {
  path: string;
  fileName: string;
  kind: MobilePdfKind;
  byteLength: number;
}

export interface MobilePaper {
  id: string;
  source: MobilePaperSource;
  arxivId?: string;
  title: string;
  titleZh?: string;
  authors: string[];
  year: string;
  abstract?: string;
  abstractZh?: string;
  categories: string[];
  sourcePdf: MobileStoredPdf;
  translatedPdf?: MobileStoredPdf;
  addedAt: string;
  lastOpenedAt: string;
  lastPage: number;
  pageCount?: number;
}

export interface MobileTranslationEntry {
  sourceHash: string;
  page: number;
  original: string;
  translation: string;
  translatedAt: string;
  model: string;
}

export interface MobileTranslationPreferences {
  baseURL: string;
  model: string;
}

export interface MobileTranslationSession extends MobileTranslationPreferences {
  apiKey: string;
}

export function createImportedMobilePaper(input: {
  id: string;
  fileName: string;
  storedPdf: MobileStoredPdf;
  now?: string;
}): MobilePaper {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    source: 'import',
    title: stripPdfExtension(input.fileName),
    authors: [],
    year: '',
    categories: [],
    sourcePdf: input.storedPdf,
    addedAt: now,
    lastOpenedAt: now,
    lastPage: 1
  };
}

export function createArxivMobilePaper(input: {
  paper: ArxivPaper;
  storedPdf: MobileStoredPdf;
  now?: string;
}): MobilePaper {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `arxiv-${sanitizeIdentifier(input.paper.stableId)}`,
    source: 'arxiv',
    arxivId: input.paper.stableId,
    title: input.paper.title,
    authors: input.paper.authors,
    year: input.paper.published.slice(0, 4),
    abstract: input.paper.summary,
    categories: input.paper.categories,
    sourcePdf: input.storedPdf,
    addedAt: now,
    lastOpenedAt: now,
    lastPage: 1
  };
}

export function upsertMobilePaper(library: MobilePaper[], incoming: MobilePaper): MobilePaper[] {
  const existing = library.find((paper) => paper.id === incoming.id);
  if (!existing) {
    return [incoming, ...library];
  }
  return [
    {
      ...existing,
      ...incoming,
      translatedPdf: incoming.translatedPdf ?? existing.translatedPdf,
      addedAt: existing.addedAt,
      lastPage: incoming.lastPage || existing.lastPage
    },
    ...library.filter((paper) => paper.id !== incoming.id)
  ];
}

export function updateMobilePaper(
  library: MobilePaper[],
  paperId: string,
  updates: Partial<MobilePaper>
): MobilePaper[] {
  return library.map((paper) =>
    paper.id === paperId
      ? {
          ...paper,
          ...updates,
          id: paper.id,
          lastPage: Math.max(1, Number(updates.lastPage ?? paper.lastPage) || 1)
        }
      : paper
  );
}

export function parseMobileLibrary(value: string | null): MobilePaper[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isMobilePaper).slice(0, 500);
  } catch {
    return [];
  }
}

export function parseTranslationEntries(value: string): MobileTranslationEntry[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isTranslationEntry).slice(-600);
  } catch {
    return [];
  }
}

export function mergeTranslationEntry(
  entries: MobileTranslationEntry[],
  incoming: MobileTranslationEntry
): MobileTranslationEntry[] {
  return [...entries.filter((entry) => entry.sourceHash !== incoming.sourceHash), incoming].slice(-600);
}

export function createLocalPaperId(fileName: string, byteLength: number, lastModified: number): string {
  return `local-${hashString(`${fileName}|${byteLength}|${lastModified}`)}`;
}

export function sanitizeFileName(value: string): string {
  const clean = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 96);
  return clean || 'paper.pdf';
}

function stripPdfExtension(value: string): string {
  return value.replace(/\.pdf$/iu, '');
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-z0-9._-]+/giu, '-');
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isMobilePaper(value: unknown): value is MobilePaper {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const paper = value as Partial<MobilePaper>;
  return (
    typeof paper.id === 'string' &&
    typeof paper.title === 'string' &&
    typeof paper.lastPage === 'number' &&
    isStoredPdf(paper.sourcePdf)
  );
}

function isStoredPdf(value: unknown): value is MobileStoredPdf {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const pdf = value as Partial<MobileStoredPdf>;
  return typeof pdf.path === 'string' && typeof pdf.fileName === 'string' && typeof pdf.byteLength === 'number';
}

function isTranslationEntry(value: unknown): value is MobileTranslationEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Partial<MobileTranslationEntry>;
  return (
    typeof entry.sourceHash === 'string' &&
    typeof entry.page === 'number' &&
    typeof entry.original === 'string' &&
    typeof entry.translation === 'string' &&
    typeof entry.translatedAt === 'string' &&
    typeof entry.model === 'string'
  );
}
