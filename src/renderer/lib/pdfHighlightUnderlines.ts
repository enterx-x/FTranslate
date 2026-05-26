export interface HighlightSourceRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HighlightUnderlineRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SAME_LINE_TOLERANCE = 4;
const SAME_LINE_GAP = 12;
const UNDERLINE_HEIGHT = 1;

export function buildUnderlineRects(
  sourceRects: Array<HighlightSourceRect | null | undefined>,
  itemIndexes: number[],
  bounds?: { width: number; height: number }
): HighlightUnderlineRect[] {
  const uniqueIndexes = Array.from(new Set(itemIndexes)).sort((left, right) => left - right);
  const selectedRects = uniqueIndexes
    .map((index) => sourceRects[index])
    .filter((rect): rect is HighlightSourceRect => Boolean(rect))
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const mergedRects: HighlightSourceRect[] = [];

  selectedRects.forEach((rect) => {
    const previous = mergedRects.at(-1);
    if (!previous || !canMergeSameLine(previous, rect)) {
      mergedRects.push({ ...rect });
      return;
    }

    const left = Math.min(previous.left, rect.left);
    const top = Math.min(previous.top, rect.top);
    const right = Math.max(previous.left + previous.width, rect.left + rect.width);
    const bottom = Math.max(previous.top + previous.height, rect.top + rect.height);
    previous.left = left;
    previous.top = top;
    previous.width = right - left;
    previous.height = bottom - top;
  });

  return mergedRects
    .map((rect) => clampUnderlineRect(
      {
        left: Math.round(rect.left),
        top: Math.round(rect.top + rect.height + 1),
        width: Math.round(rect.width),
        height: UNDERLINE_HEIGHT
      },
      bounds
    ))
    .filter((rect): rect is HighlightUnderlineRect => Boolean(rect));
}

function canMergeSameLine(left: HighlightSourceRect, right: HighlightSourceRect): boolean {
  const sameLine =
    Math.abs(left.top - right.top) <=
    Math.max(SAME_LINE_TOLERANCE, Math.min(left.height, right.height) * 0.5);
  const gap = right.left - (left.left + left.width);
  return sameLine && gap >= 0 && gap <= SAME_LINE_GAP;
}

function clampUnderlineRect(
  rect: HighlightUnderlineRect,
  bounds?: { width: number; height: number }
): HighlightUnderlineRect | null {
  if (!bounds) {
    return rect;
  }

  const left = Math.max(0, Math.min(bounds.width, rect.left));
  const top = Math.max(0, Math.min(bounds.height - rect.height, rect.top));
  const right = Math.max(left, Math.min(bounds.width, rect.left + rect.width));
  const width = right - left;

  return width > 0 ? { ...rect, left, top, width } : null;
}
