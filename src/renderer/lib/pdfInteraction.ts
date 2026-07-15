export interface PdfZoomAnchor {
  pageNumber: number;
  ratioX: number;
  ratioY: number;
  pointerXInContainer: number;
  pointerYInContainer: number;
}

export interface AnchoredScrollInput {
  pageOffsetTop: number;
  pageOffsetLeft: number;
  pageWidth: number;
  pageHeight: number;
  ratioX: number;
  ratioY: number;
  pointerXInContainer: number;
  pointerYInContainer: number;
}

export interface AnchoredScrollPosition {
  scrollLeft: number;
  scrollTop: number;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.4;
const WHEEL_SCALE_STEP = 0.1;

export function getWheelZoomScale(currentScale: number, deltaY: number): number {
  const direction = deltaY < 0 ? 1 : -1;
  return clampScale(Number((currentScale + direction * WHEEL_SCALE_STEP).toFixed(2)));
}

export function getPinchZoomScale(
  initialScale: number,
  initialDistance: number,
  currentDistance: number
): number {
  if (initialDistance <= 0 || currentDistance <= 0) {
    return clampScale(initialScale);
  }
  return clampScale(Number((initialScale * currentDistance / initialDistance).toFixed(2)));
}

export function getFitWidthScale(
  containerWidth: number,
  renderedPageWidth: number,
  renderedScale: number,
  horizontalPadding = 16
): number {
  if (containerWidth <= 0 || renderedPageWidth <= 0 || renderedScale <= 0) {
    return clampScale(renderedScale || 1);
  }
  const unscaledPageWidth = renderedPageWidth / renderedScale;
  return clampScale((containerWidth - horizontalPadding) / unscaledPageWidth);
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function buildAnchoredScrollPosition(input: AnchoredScrollInput): AnchoredScrollPosition {
  return {
    scrollLeft: Math.max(0, input.pageOffsetLeft + input.pageWidth * input.ratioX - input.pointerXInContainer),
    scrollTop: Math.max(0, input.pageOffsetTop + input.pageHeight * input.ratioY - input.pointerYInContainer)
  };
}
