import type { MobileTranslationEntry } from './mobileTypes';

export interface MobileExtractionSourceSummary {
  textPages: number;
  ocrPages: number;
  label: string;
  detail: string;
}

export function summarizeMobileExtractionSources(
  entries: MobileTranslationEntry[],
  pageCount?: number
): MobileExtractionSourceSummary {
  const textPages = uniquePageCount(entries, (entry) => entry.origin === 'text');
  const ocrPages = uniquePageCount(entries, (entry) => entry.origin === 'ocr' || entry.origin === 'vision');
  const totalSuffix = pageCount ? `，共 ${pageCount} 页` : '';

  if (textPages > 0 && ocrPages === 0) {
    return {
      textPages,
      ocrPages,
      label: `PDF 文字层 ${textPages} 页`,
      detail: `已直接读取 PDF 文字层${totalSuffix || `，共 ${textPages} 页`}；未启动本地 OCR。`
    };
  }
  if (ocrPages > 0 && textPages === 0) {
    return {
      textPages,
      ocrPages,
      label: `本地 OCR ${ocrPages} 页`,
      detail: `PDF 没有可用文字层，已在本机完成 ${ocrPages} 页 OCR。`
    };
  }
  if (textPages > 0 && ocrPages > 0) {
    return {
      textPages,
      ocrPages,
      label: `文字层 ${textPages} 页 · OCR ${ocrPages} 页`,
      detail: `已直接读取 ${textPages} 页 PDF 文字层；另有 ${ocrPages} 页因没有可用文字层而使用本地 OCR。`
    };
  }
  return {
    textPages,
    ocrPages,
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
