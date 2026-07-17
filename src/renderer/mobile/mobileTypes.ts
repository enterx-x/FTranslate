import type { ArxivPaper } from '../../shared/arxiv';

export type MobilePaperSource = 'import' | 'arxiv';
export type MobilePdfKind = 'source' | 'translated';
export type MobileLocalOcrStatus = 'pending' | 'running' | 'completed' | 'failed';
export const MOBILE_LOCAL_OCR_VERSION = 4;

export interface MobileStoredPdf {
  path: string;
  fileName: string;
  kind: MobilePdfKind;
  byteLength: number;
  contentHash?: string;
}

export interface MobilePaper {
  id: string;
  source: MobilePaperSource;
  arxivId?: string;
  sourceRevision?: string;
  title: string;
  customTitle?: string;
  titleZh?: string;
  authors: string[];
  year: string;
  abstract?: string;
  abstractZh?: string;
  categories: string[];
  tags: string[];
  sourcePdf: MobileStoredPdf;
  translatedPdf?: MobileStoredPdf;
  addedAt: string;
  lastOpenedAt: string;
  lastPage: number;
  pageCount?: number;
  visionOcrLastPage?: number;
  visionOcrCompleted?: boolean;
  visionOcrProcessedPages?: number[];
  localOcrVersion?: number;
  localOcrStatus?: MobileLocalOcrStatus;
  localOcrError?: string;
  figureExtractionVersion?: number;
  figureCount?: number;
}

export interface MobileFigureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export interface MobileTranslationEntry {
  sourceHash: string;
  page: number;
  original: string;
  translation: string;
  translatedAt: string;
  model: string;
  baseURL?: string;
  origin?: 'text' | 'ocr' | 'vision' | 'figure';
  order?: number;
  blockType?: 'heading' | 'paragraph' | 'formula' | 'caption';
  figureVersion?: number;
  figureKind?: 'figure' | 'table';
  figureBounds?: MobileFigureBounds;
  figureCaptionHash?: string;
  figureHasTextCaption?: boolean;
  figureTextHashes?: string[];
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
    tags: [],
    sourcePdf: input.storedPdf,
    addedAt: now,
    lastOpenedAt: now,
    lastPage: 1,
    localOcrVersion: MOBILE_LOCAL_OCR_VERSION,
    localOcrStatus: 'pending',
    visionOcrCompleted: false,
    visionOcrProcessedPages: []
  };
}

export function createArxivMobilePaper(input: {
  paper: ArxivPaper;
  storedPdf: MobileStoredPdf;
  titleZh?: string;
  abstractZh?: string;
  now?: string;
}): MobilePaper {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `arxiv-${sanitizeIdentifier(input.paper.stableId)}`,
    source: 'arxiv',
    arxivId: input.paper.stableId,
    sourceRevision: input.paper.id || input.paper.pdfUrl,
    title: input.paper.title,
    ...(input.titleZh ? { titleZh: input.titleZh } : {}),
    authors: input.paper.authors,
    year: input.paper.published.slice(0, 4),
    abstract: input.paper.summary,
    ...(input.abstractZh ? { abstractZh: input.abstractZh } : {}),
    categories: input.paper.categories,
    tags: [],
    sourcePdf: input.storedPdf,
    addedAt: now,
    lastOpenedAt: now,
    lastPage: 1,
    localOcrVersion: MOBILE_LOCAL_OCR_VERSION,
    localOcrStatus: 'pending',
    visionOcrCompleted: false,
    visionOcrProcessedPages: []
  };
}

export function upsertMobilePaper(library: MobilePaper[], incoming: MobilePaper): MobilePaper[] {
  const existing = library.find((paper) => paper.id === incoming.id);
  if (!existing) {
    return [incoming, ...library];
  }
  const sourceEquivalent = isMobilePaperSourceEquivalent(existing, incoming);
  const resetLocalOcr = !sourceEquivalent || (
    incoming.localOcrStatus === 'pending' && existing.localOcrVersion !== incoming.localOcrVersion
  );
  return [
    {
      ...existing,
      ...incoming,
      translatedPdf: sourceEquivalent ? incoming.translatedPdf ?? existing.translatedPdf : incoming.translatedPdf,
      customTitle: existing.customTitle,
      tags: existing.tags,
      addedAt: existing.addedAt,
      lastPage: sourceEquivalent ? existing.lastPage : incoming.lastPage,
      pageCount: sourceEquivalent ? existing.pageCount ?? incoming.pageCount : incoming.pageCount,
      visionOcrLastPage: sourceEquivalent && !resetLocalOcr ? existing.visionOcrLastPage ?? incoming.visionOcrLastPage : incoming.visionOcrLastPage,
      visionOcrCompleted: sourceEquivalent && !resetLocalOcr ? existing.visionOcrCompleted ?? incoming.visionOcrCompleted : incoming.visionOcrCompleted,
      visionOcrProcessedPages: sourceEquivalent && !resetLocalOcr
        ? existing.visionOcrProcessedPages ?? incoming.visionOcrProcessedPages
        : incoming.visionOcrProcessedPages,
      localOcrVersion: incoming.localOcrVersion ?? existing.localOcrVersion,
      localOcrStatus: resetLocalOcr
        ? incoming.localOcrStatus
        : existing.localOcrStatus ?? incoming.localOcrStatus,
      localOcrError: resetLocalOcr ? incoming.localOcrError : existing.localOcrError,
      figureExtractionVersion: sourceEquivalent
        ? existing.figureExtractionVersion ?? incoming.figureExtractionVersion
        : incoming.figureExtractionVersion,
      figureCount: sourceEquivalent ? existing.figureCount ?? incoming.figureCount : incoming.figureCount
    },
    ...library.filter((paper) => paper.id !== incoming.id)
  ];
}

export function updateMobilePaper(
  library: MobilePaper[],
  paperId: string,
  updates: Partial<MobilePaper>
): MobilePaper[] {
  return library.map((paper) => {
    if (paper.id !== paperId) {
      return paper;
    }
    const updated: MobilePaper = {
      ...paper,
      ...updates,
      id: paper.id,
      lastPage: Math.max(1, Number(updates.lastPage ?? paper.lastPage) || 1),
      tags: updates.tags ? normalizeMobilePaperTags(updates.tags) : paper.tags
    };
    if (Object.prototype.hasOwnProperty.call(updates, 'customTitle')) {
      const customTitle = typeof updates.customTitle === 'string' ? updates.customTitle.trim().slice(0, 120) : '';
      if (customTitle) {
        updated.customTitle = customTitle;
      } else {
        delete updated.customTitle;
      }
    }
    return updated;
  });
}

export function normalizeMobilePaperTags(tags: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of tags) {
    const tag = value.trim().replace(/\s+/gu, ' ').slice(0, 24);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(tag);
    if (normalized.length >= 12) {
      break;
    }
  }
  return normalized;
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
    return parsed.map(normalizeMobilePaper).filter((paper): paper is MobilePaper => paper !== null).slice(0, 500);
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
    return parsed.filter(isTranslationEntry);
  } catch {
    return [];
  }
}

export function mergeTranslationEntry(
  entries: MobileTranslationEntry[],
  incoming: MobileTranslationEntry
): MobileTranslationEntry[] {
  return [...entries.filter((entry) => entry.sourceHash !== incoming.sourceHash), incoming];
}

export function replaceMobileOcrPageEntries(
  entries: MobileTranslationEntry[],
  page: number,
  incoming: MobileTranslationEntry[]
): MobileTranslationEntry[] {
  const normalizedPage = Math.max(1, Math.trunc(page));
  return [
    ...entries.filter((entry) => (
      entry.page !== normalizedPage || (entry.origin !== 'text' && entry.origin !== 'ocr' && entry.origin !== 'vision')
    )),
    ...incoming
  ];
}

export function replaceMobileFigurePageEntries(
  entries: MobileTranslationEntry[],
  page: number,
  incoming: MobileTranslationEntry[]
): MobileTranslationEntry[] {
  const normalizedPage = Math.max(1, Math.trunc(page));
  return [
    ...entries.filter((entry) => entry.page !== normalizedPage || entry.origin !== 'figure'),
    ...incoming
  ];
}

export function isMobilePaperSourceEquivalent(left: MobilePaper, right: MobilePaper): boolean {
  if (left.sourceRevision && right.sourceRevision) {
    return left.sourceRevision === right.sourceRevision;
  }
  if (left.sourcePdf.contentHash && right.sourcePdf.contentHash) {
    return left.sourcePdf.contentHash === right.sourcePdf.contentHash;
  }
  return (
    left.sourcePdf.path === right.sourcePdf.path &&
    left.sourcePdf.fileName === right.sourcePdf.fileName &&
    left.sourcePdf.byteLength === right.sourcePdf.byteLength
  );
}

export function isTranslationEntryCurrent(
  entry: MobileTranslationEntry,
  session: MobileTranslationPreferences
): boolean {
  if (!entry.translation.trim()) {
    return false;
  }
  const sameModel = entry.model.trim() === session.model.trim();
  const sameBaseURL = !entry.baseURL || normalizeBaseURL(entry.baseURL) === normalizeBaseURL(session.baseURL);
  return sameModel && sameBaseURL;
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

function normalizeMobilePaper(value: unknown): MobilePaper | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const paper = value as Partial<MobilePaper>;
  const sourcePdf = normalizeStoredPdf(paper.sourcePdf, 'source');
  if (typeof paper.id !== 'string' || !paper.id.trim() || typeof paper.title !== 'string' || !sourcePdf) {
    return null;
  }
  const addedAt = typeof paper.addedAt === 'string' ? paper.addedAt : '';
  const translatedPdf = normalizeStoredPdf(paper.translatedPdf, 'translated');
  const normalized: MobilePaper = {
    id: paper.id,
    source: paper.source === 'arxiv' || paper.source === 'import' ? paper.source : paper.arxivId ? 'arxiv' : 'import',
    title: paper.title,
    authors: normalizeStringArray(paper.authors),
    year: typeof paper.year === 'string' ? paper.year : '',
    categories: normalizeStringArray(paper.categories),
    tags: normalizeMobilePaperTags(normalizeStringArray(paper.tags)),
    sourcePdf,
    addedAt,
    lastOpenedAt: typeof paper.lastOpenedAt === 'string' ? paper.lastOpenedAt : addedAt,
    lastPage: Math.max(1, Math.trunc(Number(paper.lastPage) || 1))
  };
  if (typeof paper.arxivId === 'string') normalized.arxivId = paper.arxivId;
  if (typeof paper.sourceRevision === 'string') normalized.sourceRevision = paper.sourceRevision;
  if (typeof paper.customTitle === 'string' && paper.customTitle.trim()) normalized.customTitle = paper.customTitle.trim().slice(0, 120);
  if (typeof paper.titleZh === 'string') normalized.titleZh = paper.titleZh;
  if (typeof paper.abstract === 'string') normalized.abstract = paper.abstract;
  if (typeof paper.abstractZh === 'string') normalized.abstractZh = paper.abstractZh;
  if (translatedPdf) normalized.translatedPdf = translatedPdf;
  if (Number.isFinite(paper.pageCount) && Number(paper.pageCount) > 0) {
    normalized.pageCount = Math.trunc(Number(paper.pageCount));
  }
  if (Number.isFinite(paper.visionOcrLastPage) && Number(paper.visionOcrLastPage) > 0) {
    normalized.visionOcrLastPage = Math.trunc(Number(paper.visionOcrLastPage));
  }
  if (typeof paper.visionOcrCompleted === 'boolean') {
    normalized.visionOcrCompleted = paper.visionOcrCompleted;
  }
  const visionOcrProcessedPages = normalizePageNumbers(paper.visionOcrProcessedPages);
  if (visionOcrProcessedPages.length > 0) {
    normalized.visionOcrProcessedPages = visionOcrProcessedPages;
  }
  if (Number.isFinite(paper.localOcrVersion) && Number(paper.localOcrVersion) > 0) {
    normalized.localOcrVersion = Math.trunc(Number(paper.localOcrVersion));
  }
  if (
    paper.localOcrStatus === 'pending' ||
    paper.localOcrStatus === 'running' ||
    paper.localOcrStatus === 'completed' ||
    paper.localOcrStatus === 'failed'
  ) {
    normalized.localOcrStatus = paper.localOcrStatus;
  }
  if (typeof paper.localOcrError === 'string' && paper.localOcrError.trim()) {
    normalized.localOcrError = paper.localOcrError.trim().slice(0, 500);
  }
  if (Number.isFinite(paper.figureExtractionVersion) && Number(paper.figureExtractionVersion) > 0) {
    normalized.figureExtractionVersion = Math.trunc(Number(paper.figureExtractionVersion));
  }
  if (Number.isFinite(paper.figureCount) && Number(paper.figureCount) >= 0) {
    normalized.figureCount = Math.trunc(Number(paper.figureCount));
  }
  return normalized;
}

function normalizePageNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value
    .map((page) => Math.trunc(Number(page)))
    .filter((page) => Number.isFinite(page) && page > 0)))
    .sort((left, right) => left - right);
}

function normalizeStoredPdf(value: unknown, fallbackKind: MobilePdfKind): MobileStoredPdf | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const pdf = value as Partial<MobileStoredPdf>;
  if (
    typeof pdf.path !== 'string' ||
    !pdf.path.trim() ||
    typeof pdf.fileName !== 'string' ||
    !Number.isFinite(pdf.byteLength) ||
    Number(pdf.byteLength) < 0
  ) {
    return null;
  }
  return {
    path: pdf.path,
    fileName: pdf.fileName,
    kind: pdf.kind === 'source' || pdf.kind === 'translated' ? pdf.kind : fallbackKind,
    byteLength: Number(pdf.byteLength),
    ...(typeof pdf.contentHash === 'string' && pdf.contentHash ? { contentHash: pdf.contentHash } : {})
  };
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
    typeof entry.model === 'string' &&
    (entry.baseURL === undefined || typeof entry.baseURL === 'string')
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizeBaseURL(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}
