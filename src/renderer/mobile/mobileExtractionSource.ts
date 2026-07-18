import type { MobileTranslationEntry } from './mobileTypes';

export interface MobileExtractionSourceSummary {
  textPages: number;
  ocrPages: number;
  compatibilityPages: number;
  label: string;
  detail: string;
  warning?: string;
}

export function summarizeMobileExtractionSources(
  entries: MobileTranslationEntry[],
  pageCount?: number
): MobileExtractionSourceSummary {
  const textPages = uniquePageCount(entries, (entry) => entry.origin === 'text');
  const ocrPages = uniquePageCount(entries, (entry) => entry.origin === 'ocr' || entry.origin === 'vision');
  const compatibilityPages = uniquePageCount(entries, (entry) => (
    entry.origin === 'text' && entry.extractionMode === 'compatibility'
  ));
  const warning = entries
    .map((entry) => typeof entry.extractionWarning === 'string' ? entry.extractionWarning.trim() : '')
    .find(Boolean);
  const totalSuffix = pageCount ? `，共 ${pageCount} 页` : '';

  if (textPages > 0 && ocrPages === 0) {
    return {
      textPages,
      ocrPages,
      compatibilityPages,
      label: compatibilityPages > 0
        ? `PDF 文字层 ${textPages} 页 · 兼容重排 ${compatibilityPages} 页`
        : `PDF 文字层 ${textPages} 页`,
      detail: compatibilityPages > 0
        ? `已读取 PDF 文字层${totalSuffix || `，共 ${textPages} 页`}；其中 ${compatibilityPages} 页使用 Safari 兼容重排，未启动本地 OCR。`
        : `已直接读取 PDF 文字层${totalSuffix || `，共 ${textPages} 页`}；未启动本地 OCR。`,
      ...(warning ? { warning } : {})
    };
  }
  if (ocrPages > 0 && textPages === 0) {
    return {
      textPages,
      ocrPages,
      compatibilityPages,
      label: `本地 OCR ${ocrPages} 页`,
      detail: `有 ${ocrPages} 页未能保留可用文字层，最终在本机完成 OCR。${warning ? ` 降级原因：${warning}` : ''}`,
      ...(warning ? { warning } : {})
    };
  }
  if (textPages > 0 && ocrPages > 0) {
    return {
      textPages,
      ocrPages,
      compatibilityPages,
      label: `文字层 ${textPages} 页${compatibilityPages ? `（兼容 ${compatibilityPages}）` : ''} · OCR ${ocrPages} 页`,
      detail: `已读取 ${textPages} 页 PDF 文字层；另有 ${ocrPages} 页未能保留可用文字层而使用本地 OCR。${warning ? ` 降级原因：${warning}` : ''}`,
      ...(warning ? { warning } : {})
    };
  }
  return {
    textPages,
    ocrPages,
    compatibilityPages,
    label: '原文来源待确认',
    detail: '原文已逐页保存在本机；旧缓存没有记录页面来自 PDF 文字层还是本地 OCR。'
  };
}

function uniquePageCount(
  entries: MobileTranslationEntry[],
  predicate: (entry: MobileTranslationEntry) => boolean
): number {
  return new Set(entries.filter(predicate).map((entry) => entry.page)).size;
}
