import { shouldTranslateItem } from '../../shared/aiTranslation';
import type { ExtractedPdfBlock } from './pdfTextStructure';
import type { TranslationDocument, TranslationItem } from './translation';

interface AiCacheItemPatch {
  translation: string;
  translatedAt: string;
  provider?: string;
  model?: string;
}

export interface AiQueueStats {
  total: number;
  cached: number;
  pending: number;
  skipped: number;
}

export interface AiQueueSection {
  id: string;
  section: string;
  sectionOrder: number;
  startIndex: number;
  items: Array<{
    item: TranslationItem;
    index: number;
  }>;
  stats: AiQueueStats;
}

export function buildAiCacheDocument(
  blocks: ExtractedPdfBlock[],
  pdfFileName?: string,
  existingDocument?: TranslationDocument | null
): TranslationDocument {
  const cachedItems = buildCachedItemMap(existingDocument?.items ?? []);
  const translatableBlocks = getTranslatableExtractedBlocks(blocks);

  return {
    kind: 'json',
    sourcePath: existingDocument?.kind === 'json' ? existingDocument.sourcePath : undefined,
    sourceName:
      existingDocument?.kind === 'json' && existingDocument.sourceName
        ? existingDocument.sourceName
        : getDefaultAiCacheFileName(pdfFileName),
    items: translatableBlocks.map((block) => {
      const cached = cachedItems.get(block.sourceHash) ?? cachedItems.get(normalizeOriginal(block.original));

      return {
        ...block,
        translation: cached?.translation ?? '',
        translatedAt: cached?.translatedAt,
        provider: cached?.provider,
        model: cached?.model
      };
    })
  };
}

export function cloneJsonDocumentForAi(document: TranslationDocument | null): TranslationDocument | null {
  if (document?.kind !== 'json') {
    return null;
  }

  return {
    ...document,
    items: document.items.map((item) => ({ ...item }))
  };
}

export function updateAiCacheItem(
  document: TranslationDocument | null,
  index: number,
  patch: AiCacheItemPatch
): TranslationDocument | null {
  if (document?.kind !== 'json') {
    return document;
  }

  return {
    ...document,
    items: document.items.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            translation: patch.translation,
            translatedAt: patch.translatedAt,
            provider: patch.provider,
            model: patch.model
          }
        : item
    )
  };
}

export function getCurrentAiCacheItem(
  document: TranslationDocument | null,
  index: number
): TranslationItem | null {
  if (document?.kind !== 'json') {
    return null;
  }

  return document.items[index] ?? null;
}

export function getTranslatableExtractedBlocks(blocks: ExtractedPdfBlock[]): ExtractedPdfBlock[] {
  return blocks.filter((block) => block.type === 'paragraph' && looksTranslatableParagraph(block.original));
}

export function countPendingAiTranslations(items: TranslationItem[]): number {
  return items.filter((item) => shouldTranslateItem(item)).length;
}

export function getAiQueueStats(items: TranslationItem[]): {
  total: number;
  cached: number;
  pending: number;
  skipped: number;
} {
  const pending = countPendingAiTranslations(items);
  const cached = items.filter((item) => item.translation.trim()).length;

  return {
    total: items.length,
    cached,
    pending,
    skipped: Math.max(0, items.length - cached - pending)
  };
}

export function getAiQueueSections(items: TranslationItem[]): AiQueueSection[] {
  const sections: AiQueueSection[] = [];
  const sectionByKey = new Map<string, AiQueueSection>();

  items.forEach((item, index) => {
    const section = item.section?.trim() || 'Untitled';
    const key = item.sectionId || section;
    let group = sectionByKey.get(key);

    if (!group) {
      group = {
        id: item.sectionId || `section-${sections.length + 1}`,
        section,
        sectionOrder: item.sectionOrder ?? sections.length + 1,
        startIndex: index,
        items: [],
        stats: { total: 0, cached: 0, pending: 0, skipped: 0 }
      };
      sectionByKey.set(key, group);
      sections.push(group);
    }

    group.items.push({ item, index });
  });

  sections.forEach((section) => {
    section.items.sort((left, right) => {
      const leftOrder = left.item.paragraphOrder ?? left.index;
      const rightOrder = right.item.paragraphOrder ?? right.index;
      return leftOrder - rightOrder || left.index - right.index;
    });
    section.stats = getAiQueueStats(section.items.map(({ item }) => item));
  });

  return sections.sort((left, right) => left.sectionOrder - right.sectionOrder || left.startIndex - right.startIndex);
}

export function getDefaultAiCacheFileName(pdfFileName?: string): string {
  if (!pdfFileName) {
    return 'ai-translation-cache.json';
  }

  return `${pdfFileName.replace(/\.[^.]+$/u, '')}-ai-cache.json`;
}

function buildCachedItemMap(items: TranslationItem[]): Map<string, TranslationItem> {
  const map = new Map<string, TranslationItem>();

  items.forEach((item) => {
    if (item.sourceHash) {
      map.set(item.sourceHash, item);
    }

    if (item.original.trim()) {
      map.set(normalizeOriginal(item.original), item);
    }
  });

  return map;
}

function normalizeOriginal(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function looksTranslatableParagraph(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || /[□�]/u.test(normalized)) {
    return false;
  }

  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = normalized.match(/\p{L}/gu) ?? [];
  const readableCharacters = normalized.match(/[\p{L}\p{N}\p{P}\p{Zs}]/gu) ?? [];
  const readableRatio = readableCharacters.length / Math.max(1, normalized.length);

  return words.length >= 4 && letters.length >= 8 && readableRatio >= 0.85;
}
