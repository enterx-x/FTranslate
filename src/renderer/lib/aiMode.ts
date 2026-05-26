import { shouldTranslateItem } from '../../shared/aiTranslation';
import type { ExtractedPdfBlock } from './pdfTextStructure';
import type { TranslationDocument, TranslationItem } from './translation';

export function buildAiCacheDocument(
  blocks: ExtractedPdfBlock[],
  pdfFileName?: string,
  existingDocument?: TranslationDocument | null
): TranslationDocument {
  const cachedItems = buildCachedItemMap(existingDocument?.items ?? []);

  return {
    kind: 'json',
    sourcePath: existingDocument?.kind === 'json' ? existingDocument.sourcePath : undefined,
    sourceName:
      existingDocument?.kind === 'json' && existingDocument.sourceName
        ? existingDocument.sourceName
        : getDefaultAiCacheFileName(pdfFileName),
    items: blocks.map((block) => {
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

export function countPendingAiTranslations(items: TranslationItem[]): number {
  return items.filter((item) => shouldTranslateItem(item)).length;
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
