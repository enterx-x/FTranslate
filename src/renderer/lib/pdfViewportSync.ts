export interface PdfScrollMetrics {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
}

export interface PdfViewportState {
  topRatio: number;
  leftRatio: number;
  source?: string;
}

export interface PdfScrollPosition {
  scrollTop: number;
  scrollLeft: number;
}

// 用滚动比例同步两个 PDF viewer，避免原文和译文 PDF 高度略有差异时直接套用像素值导致漂移。
export function buildPdfViewportState(
  metrics: PdfScrollMetrics,
  source?: string
): PdfViewportState {
  return {
    topRatio: safeRatio(metrics.scrollTop, metrics.scrollHeight - metrics.clientHeight),
    leftRatio: safeRatio(metrics.scrollLeft, metrics.scrollWidth - metrics.clientWidth),
    source
  };
}

export function buildPdfScrollPosition(
  state: PdfViewportState,
  metrics: Pick<PdfScrollMetrics, 'scrollHeight' | 'scrollWidth' | 'clientHeight' | 'clientWidth'>
): PdfScrollPosition {
  const maxTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const maxLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth);

  return {
    scrollTop: Math.round(clamp01(state.topRatio) * maxTop),
    scrollLeft: Math.round(clamp01(state.leftRatio) * maxLeft)
  };
}

function safeRatio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }

  return clamp01(value / max);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
