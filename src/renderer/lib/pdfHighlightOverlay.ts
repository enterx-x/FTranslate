export interface HighlightRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface HighlightPageBounds {
  width: number;
  height: number;
}

export interface HighlightOverlayLine {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface HighlightLineGroup {
  rects: HighlightRectLike[];
  top: number;
  bottom: number;
}

const UNDERLINE_HEIGHT = 1;
const MIN_RECT_SIZE = 0.5;

export function buildHighlightOverlayLines(
  rects: HighlightRectLike[],
  pageBounds: HighlightPageBounds
): HighlightOverlayLine[] {
  const clampedRects = rects
    .map((rect) => clampRectToPage(rect, pageBounds))
    .filter((rect): rect is HighlightRectLike => Boolean(rect && rect.width > MIN_RECT_SIZE && rect.height > MIN_RECT_SIZE))
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const groups: HighlightLineGroup[] = [];

  clampedRects.forEach((rect) => {
    const existingGroup = groups.find((group) => belongsToSameVisualLine(rect, group));
    if (existingGroup) {
      existingGroup.rects.push(rect);
      existingGroup.top = Math.min(existingGroup.top, rect.top);
      existingGroup.bottom = Math.max(existingGroup.bottom, rect.bottom);
      return;
    }

    groups.push({
      rects: [rect],
      top: rect.top,
      bottom: rect.bottom
    });
  });

  return groups
    .map((group) => buildOverlayLine(group, pageBounds))
    .sort((left, right) => left.top - right.top || left.left - right.left);
}

function clampRectToPage(rect: HighlightRectLike, pageBounds: HighlightPageBounds): HighlightRectLike | null {
  const left = clamp(rect.left, 0, pageBounds.width);
  const right = clamp(rect.right, 0, pageBounds.width);
  const top = clamp(rect.top, 0, pageBounds.height);
  const bottom = clamp(rect.bottom, 0, pageBounds.height);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function belongsToSameVisualLine(rect: HighlightRectLike, group: HighlightLineGroup): boolean {
  const overlap = Math.min(rect.bottom, group.bottom) - Math.max(rect.top, group.top);
  if (overlap <= 0) {
    return false;
  }

  const rectHeight = Math.max(MIN_RECT_SIZE, rect.height);
  const groupHeight = Math.max(MIN_RECT_SIZE, group.bottom - group.top);
  const overlapRatio = overlap / Math.min(rectHeight, groupHeight);
  return overlapRatio >= 0.35;
}

function buildOverlayLine(group: HighlightLineGroup, pageBounds: HighlightPageBounds): HighlightOverlayLine {
  const left = Math.min(...group.rects.map((rect) => rect.left));
  const right = Math.max(...group.rects.map((rect) => rect.right));
  const baseline = median(group.rects.map((rect) => rect.bottom)) ?? group.bottom;
  const top = clamp(baseline - UNDERLINE_HEIGHT, 0, pageBounds.height - UNDERLINE_HEIGHT);

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: UNDERLINE_HEIGHT
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
