export type PdfSelectionTranslationDirection = {
  sourceLanguage: 'en' | 'zh';
  targetLanguage: 'en' | 'zh';
  label: string;
};

export interface PdfSelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PdfSelectionPopoverPosition {
  left: number;
  top: number;
}

export function normalizePdfSelectionText(value: string, maxLength = 2_000): string {
  const normalized = value
    .replace(/\u00ad/gu, '')
    .replace(/([\p{L}])-\s+(?=[\p{Ll}])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.slice(0, Math.max(1, maxLength));
}

export function resolvePdfSelectionTranslationDirection(
  value: string
): PdfSelectionTranslationDirection {
  const chineseCount = value.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const latinCount = value.match(/[A-Za-z]/gu)?.length ?? 0;
  if (chineseCount > latinCount) {
    return { sourceLanguage: 'zh', targetLanguage: 'en', label: '中 → 英' };
  }
  return { sourceLanguage: 'en', targetLanguage: 'zh', label: '英 → 中' };
}

export function buildPdfSelectionPopoverPosition(
  selection: PdfSelectionRect,
  shell: PdfSelectionRect,
  popover: { width: number; height: number },
  margin = 12
): PdfSelectionPopoverPosition {
  const maxLeft = Math.max(margin, shell.width - popover.width - margin);
  const preferredLeft = selection.left - shell.left + selection.width / 2 - popover.width / 2;
  const left = clamp(preferredLeft, margin, maxLeft);
  const below = selection.bottom - shell.top + 10;
  const above = selection.top - shell.top - popover.height - 10;
  const maxTop = Math.max(margin, shell.height - popover.height - margin);
  const preferredTop = below + popover.height <= shell.height - margin ? below : above;
  return {
    left,
    top: clamp(preferredTop, margin, maxTop)
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
