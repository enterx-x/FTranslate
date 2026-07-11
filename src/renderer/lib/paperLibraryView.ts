import {
  normalizePaperTags,
  updatePaperRecord,
  type PaperRecord
} from './papers';
import type { ResearchProject } from './researchProjects';

export const PAPER_LIBRARY_VIEW_KEY = 'pdfTranslationReader:paperLibraryView';

export type PaperLibrarySortKey =
  | 'recentActivity'
  | 'title'
  | 'year'
  | 'importedAt'
  | 'lastOpenedAt'
  | 'progress';
export type PaperLibrarySortDirection = 'asc' | 'desc';
export type PaperLibraryDensity = 'compact' | 'comfortable';
export type PaperLibrarySmartView =
  | 'recent'
  | 'needsOrganizing'
  | 'pinned'
  | 'completed'
  | null;

export interface PaperLibraryViewPreferences {
  sortKey: PaperLibrarySortKey;
  sortDirection: PaperLibrarySortDirection;
  density: PaperLibraryDensity;
  inspectorCollapsed: boolean;
}

export interface PaperLibraryQuery {
  search: string;
  activeTags: string[];
  smartView: PaperLibrarySmartView;
  projectId: string | null;
  sortKey: PaperLibrarySortKey;
  sortDirection: PaperLibrarySortDirection;
}

export interface PaperTagCatalogEntry {
  key: string;
  label: string;
  count: number;
}

export interface PaperLibraryViewResult {
  items: PaperRecord[];
  total: number;
  tagCatalog: PaperTagCatalogEntry[];
}

export type PaperBulkAction =
  | { type: 'addTags'; tags: string[] }
  | { type: 'removeTags'; tags: string[] }
  | { type: 'setPinned'; value: boolean }
  | { type: 'setCompleted'; value: boolean }
  | { type: 'remove' };

export const DEFAULT_PAPER_LIBRARY_PREFERENCES: PaperLibraryViewPreferences = {
  sortKey: 'recentActivity',
  sortDirection: 'desc',
  density: 'compact',
  inspectorCollapsed: false
};

export const DEFAULT_PAPER_LIBRARY_QUERY: PaperLibraryQuery = {
  search: '',
  activeTags: [],
  smartView: null,
  projectId: null,
  sortKey: DEFAULT_PAPER_LIBRARY_PREFERENCES.sortKey,
  sortDirection: DEFAULT_PAPER_LIBRARY_PREFERENCES.sortDirection
};

const COLLATOR = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
});

export function getPaperDisplayTitle(paper: PaperRecord): string {
  return paper.chineseTitle.trim() || paper.englishTitle.trim() || paper.pdfName.trim();
}

export function getPaperProgress(paper: PaperRecord): number | undefined {
  if (paper.completedAt) {
    return 1;
  }
  if (!paper.totalPages || paper.totalPages <= 0) {
    return undefined;
  }
  return Math.min(1, Math.max(0, paper.lastPage / paper.totalPages));
}

export function getPaperActivityTime(paper: PaperRecord): number | undefined {
  const values = [paper.updatedAt, paper.lastOpenedAt, paper.importedAt]
    .map(toTimestamp)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

export function buildPaperSearchText(paper: PaperRecord): string {
  const sheetText = paper.sheetCells ? Object.values(paper.sheetCells).join(' ') : '';
  return normalizeSearchValue(
    [
      paper.chineseTitle,
      paper.englishTitle,
      paper.pdfName,
      paper.authors,
      paper.journal,
      paper.year,
      paper.tags.join(' '),
      paper.notes,
      sheetText
    ].join(' ')
  );
}

export function buildPaperTagCatalog(papers: readonly PaperRecord[]): PaperTagCatalogEntry[] {
  const entries = new Map<string, PaperTagCatalogEntry>();

  papers.forEach((paper) => {
    normalizePaperTags(paper.tags).forEach((label) => {
      const key = normalizeTagKey(label);
      const existing = entries.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        entries.set(key, { key, label, count: 1 });
      }
    });
  });

  return [...entries.values()].sort(
    (left, right) => right.count - left.count || COLLATOR.compare(left.label, right.label)
  );
}

export function buildPaperLibraryView(
  papers: readonly PaperRecord[],
  projects: readonly ResearchProject[],
  query: PaperLibraryQuery
): PaperLibraryViewResult {
  const searchTokens = normalizeSearchValue(query.search).split(' ').filter(Boolean);
  const activeTagKeys = normalizePaperTags(query.activeTags).map(normalizeTagKey);
  const projectPaperIds = query.projectId
    ? new Set(projects.find((project) => project.id === query.projectId)?.paperIds ?? [])
    : null;
  const allProjectPaperIds = new Set(projects.flatMap((project) => project.paperIds));

  const filtered = papers.filter((paper) => {
    if (searchTokens.length > 0) {
      const searchText = buildPaperSearchText(paper);
      if (!searchTokens.every((token) => searchText.includes(token))) {
        return false;
      }
    }

    if (activeTagKeys.length > 0) {
      const paperTagKeys = new Set(normalizePaperTags(paper.tags).map(normalizeTagKey));
      if (!activeTagKeys.every((tag) => paperTagKeys.has(tag))) {
        return false;
      }
    }

    if (projectPaperIds && !projectPaperIds.has(paper.id)) {
      return false;
    }

    if (!matchesSmartView(paper, query.smartView, allProjectPaperIds)) {
      return false;
    }

    return true;
  });

  return {
    items: sortPapers(filtered, query.sortKey, query.sortDirection),
    total: papers.length,
    tagCatalog: buildPaperTagCatalog(papers)
  };
}

export function sortPapers(
  papers: readonly PaperRecord[],
  sortKey: PaperLibrarySortKey,
  direction: PaperLibrarySortDirection
): PaperRecord[] {
  return papers
    .map((paper, index) => ({ paper, index, value: getSortValue(paper, sortKey) }))
    .sort((left, right) => {
      if (left.paper.isPinned !== right.paper.isPinned) {
        return left.paper.isPinned ? -1 : 1;
      }

      const leftUnknown = left.value === undefined || left.value === '';
      const rightUnknown = right.value === undefined || right.value === '';
      if (leftUnknown !== rightUnknown) {
        return leftUnknown ? 1 : -1;
      }
      if (leftUnknown && rightUnknown) {
        return left.index - right.index;
      }

      const comparison = compareSortValues(left.value!, right.value!);
      return comparison === 0
        ? left.index - right.index
        : direction === 'asc'
          ? comparison
          : -comparison;
    })
    .map(({ paper }) => paper);
}

export function applyPaperBulkAction(
  papers: readonly PaperRecord[],
  selectedIds: ReadonlySet<string>,
  action: PaperBulkAction,
  now = new Date().toISOString()
): PaperRecord[] {
  if (selectedIds.size === 0) {
    return [...papers];
  }
  if (action.type === 'remove') {
    return papers.filter((paper) => !selectedIds.has(paper.id));
  }

  return papers.map((paper) => {
    if (!selectedIds.has(paper.id)) {
      return paper;
    }

    if (action.type === 'addTags') {
      return updatePaperRecord(
        paper,
        { tags: normalizePaperTags([...paper.tags, ...action.tags]) },
        now
      );
    }
    if (action.type === 'removeTags') {
      const removedKeys = new Set(normalizePaperTags(action.tags).map(normalizeTagKey));
      return updatePaperRecord(
        paper,
        { tags: paper.tags.filter((tag) => !removedKeys.has(normalizeTagKey(tag))) },
        now
      );
    }
    if (action.type === 'setPinned') {
      return updatePaperRecord(paper, { isPinned: action.value }, now);
    }
    return updatePaperRecord(
      paper,
      { completedAt: action.value ? now : undefined },
      now
    );
  });
}

export function renameTagAcrossLibrary(
  papers: readonly PaperRecord[],
  currentTag: string,
  nextTag: string,
  now = new Date().toISOString()
): PaperRecord[] {
  const currentKey = normalizeTagKey(currentTag);
  const [normalizedNextTag] = normalizePaperTags([nextTag]);
  if (!currentKey || !normalizedNextTag) {
    return [...papers];
  }

  return papers.map((paper) => {
    if (!paper.tags.some((tag) => normalizeTagKey(tag) === currentKey)) {
      return paper;
    }
    return updatePaperRecord(
      paper,
      {
        tags: normalizePaperTags(
          paper.tags.map((tag) =>
            normalizeTagKey(tag) === currentKey ? normalizedNextTag : tag
          )
        )
      },
      now
    );
  });
}

export function deleteTagAcrossLibrary(
  papers: readonly PaperRecord[],
  tag: string,
  now = new Date().toISOString()
): PaperRecord[] {
  const tagKey = normalizeTagKey(tag);
  if (!tagKey) {
    return [...papers];
  }

  return papers.map((paper) => {
    if (!paper.tags.some((paperTag) => normalizeTagKey(paperTag) === tagKey)) {
      return paper;
    }
    return updatePaperRecord(
      paper,
      { tags: paper.tags.filter((paperTag) => normalizeTagKey(paperTag) !== tagKey) },
      now
    );
  });
}

export function getSelectionSummary(
  selectedIds: ReadonlySet<string>,
  visiblePapers: readonly PaperRecord[]
): { total: number; visible: number; hidden: number } {
  const visibleIds = new Set(visiblePapers.map((paper) => paper.id));
  const visible = [...selectedIds].filter((paperId) => visibleIds.has(paperId)).length;
  return {
    total: selectedIds.size,
    visible,
    hidden: Math.max(0, selectedIds.size - visible)
  };
}

export function parsePaperLibraryViewPreferences(
  value: string | null
): PaperLibraryViewPreferences {
  if (!value) {
    return { ...DEFAULT_PAPER_LIBRARY_PREFERENCES };
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      sortKey: isSortKey(parsed.sortKey)
        ? parsed.sortKey
        : DEFAULT_PAPER_LIBRARY_PREFERENCES.sortKey,
      sortDirection:
        parsed.sortDirection === 'asc' || parsed.sortDirection === 'desc'
          ? parsed.sortDirection
          : DEFAULT_PAPER_LIBRARY_PREFERENCES.sortDirection,
      density:
        parsed.density === 'compact' || parsed.density === 'comfortable'
          ? parsed.density
          : DEFAULT_PAPER_LIBRARY_PREFERENCES.density,
      inspectorCollapsed:
        typeof parsed.inspectorCollapsed === 'boolean'
          ? parsed.inspectorCollapsed
          : DEFAULT_PAPER_LIBRARY_PREFERENCES.inspectorCollapsed
    };
  } catch {
    return { ...DEFAULT_PAPER_LIBRARY_PREFERENCES };
  }
}

export function serializePaperLibraryViewPreferences(
  preferences: PaperLibraryViewPreferences
): string {
  return JSON.stringify(preferences);
}

function matchesSmartView(
  paper: PaperRecord,
  smartView: PaperLibrarySmartView,
  projectPaperIds: ReadonlySet<string>
): boolean {
  if (!smartView) {
    return true;
  }
  if (smartView === 'recent') {
    return toTimestamp(paper.lastOpenedAt) !== undefined;
  }
  if (smartView === 'pinned') {
    return paper.isPinned;
  }
  if (smartView === 'completed') {
    return Boolean(paper.completedAt);
  }
  return (
    !getPaperDisplayTitle(paper) ||
    !paper.authors.trim() ||
    !paper.year.trim() ||
    paper.tags.length === 0 ||
    !projectPaperIds.has(paper.id)
  );
}

function getSortValue(
  paper: PaperRecord,
  sortKey: PaperLibrarySortKey
): string | number | undefined {
  if (sortKey === 'title') {
    return getPaperDisplayTitle(paper) || undefined;
  }
  if (sortKey === 'year') {
    const year = Number.parseInt(paper.year, 10);
    return Number.isFinite(year) && year > 0 ? year : undefined;
  }
  if (sortKey === 'importedAt') {
    return toTimestamp(paper.importedAt);
  }
  if (sortKey === 'lastOpenedAt') {
    return toTimestamp(paper.lastOpenedAt);
  }
  if (sortKey === 'progress') {
    return getPaperProgress(paper);
  }
  return getPaperActivityTime(paper);
}

function compareSortValues(left: string | number, right: string | number): number {
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : COLLATOR.compare(String(left), String(right));
}

function normalizeSearchValue(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function normalizeTagKey(value: string): string {
  return normalizeSearchValue(value);
}

function toTimestamp(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return value && Number.isFinite(timestamp) ? timestamp : undefined;
}

function isSortKey(value: unknown): value is PaperLibrarySortKey {
  return (
    value === 'recentActivity' ||
    value === 'title' ||
    value === 'year' ||
    value === 'importedAt' ||
    value === 'lastOpenedAt' ||
    value === 'progress'
  );
}
