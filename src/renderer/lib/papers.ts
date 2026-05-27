import type { TranslationDocument } from './translation';

export const PAPER_LIBRARY_KEY = 'pdfTranslationReader:paperLibrary';

export type PaperResearchColumnKey =
  | 'innovation'
  | 'limitations'
  | 'method'
  | 'dataset'
  | 'metrics'
  | 'reproducePlan'
  | 'futureIdeas';

export interface PaperResearchColumn {
  key: PaperResearchColumnKey;
  label: string;
  aiHint: string;
}

export const PAPER_RESEARCH_COLUMNS: PaperResearchColumn[] = [
  { key: 'innovation', label: '创新点', aiHint: '总结这篇论文最核心的创新点，适合放入论文阅读表格。' },
  { key: 'limitations', label: '局限点', aiHint: '总结这篇论文的局限、不足和可能失败场景。' },
  { key: 'method', label: '方法', aiHint: '概括论文方法、模型结构或算法流程。' },
  { key: 'dataset', label: '数据/任务', aiHint: '提取论文使用的数据集、任务、环境或机器人平台。' },
  { key: 'metrics', label: '指标/结果', aiHint: '提取论文评价指标和关键实验结果。' },
  { key: 'reproducePlan', label: '复现计划', aiHint: '给出复现这篇论文需要关注的代码、数据、环境和实验步骤。' },
  { key: 'futureIdeas', label: '后续 idea', aiHint: '基于这篇论文提出可用于后续研究或改进的想法。' }
];

export type PaperSheetCells = Partial<Record<PaperResearchColumnKey, string>>;

export interface PaperRecord {
  id: string;
  pdfPath: string;
  pdfName: string;
  translationPath: string;
  translationName: string;
  aiCachePath?: string;
  aiCacheName?: string;
  chineseTitle: string;
  englishTitle: string;
  journal: string;
  authors: string;
  year: string;
  notes: string;
  sheetCells: PaperSheetCells;
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
    aiCachePath: undefined,
    aiCacheName: undefined,
    chineseTitle: metadata.chineseTitle || truncateText(firstTranslation, 40) || input.translationName,
    englishTitle: metadata.englishTitle || stripExtension(input.pdfName),
    journal: metadata.journal || '',
    authors: metadata.authors || '',
    year: metadata.year || '',
    notes: '',
    sheetCells: {},
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
    aiCachePath: existing.aiCachePath || incoming.aiCachePath,
    aiCacheName: existing.aiCacheName || incoming.aiCacheName,
    notes: existing.notes || incoming.notes,
    sheetCells: {
      ...incoming.sheetCells,
      ...existing.sheetCells
    },
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
      | 'aiCachePath'
      | 'aiCacheName'
      | 'chineseTitle'
      | 'englishTitle'
      | 'journal'
      | 'authors'
      | 'year'
      | 'notes'
      | 'sheetCells'
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

export function getPaperSheetCell(record: PaperRecord, key: PaperResearchColumnKey): string {
  return record.sheetCells[key] ?? '';
}

export function updatePaperSheetCell(
  record: PaperRecord,
  key: PaperResearchColumnKey,
  value: string
): PaperRecord {
  return {
    ...record,
    sheetCells: {
      ...record.sheetCells,
      [key]: value
    }
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
    aiCachePath: toText(record.aiCachePath) || undefined,
    aiCacheName: toText(record.aiCacheName) || undefined,
    chineseTitle: toText(record.chineseTitle),
    englishTitle: toText(record.englishTitle) || stripExtension(toText(record.pdfName) || pdfPath),
    journal: toText(record.journal),
    authors: toText(record.authors),
    year: toText(record.year),
    notes: toText(record.notes),
    sheetCells: parseSheetCells(record.sheetCells),
    lastOpenedAt: toText(record.lastOpenedAt) || new Date().toISOString(),
    lastPage: Math.max(1, Number(record.lastPage) || 1)
  };
}

function parseSheetCells(value: unknown): PaperSheetCells {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const record = value as Record<string, unknown>;
  return PAPER_RESEARCH_COLUMNS.reduce<PaperSheetCells>((cells, column) => {
    const text = toText(record[column.key]);
    if (text) {
      cells[column.key] = text;
    }
    return cells;
  }, {});
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
