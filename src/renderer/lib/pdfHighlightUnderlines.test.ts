import { describe, expect, it } from 'vitest';
import { buildUnderlineRects, type HighlightSourceRect } from './pdfHighlightUnderlines';

describe('PDF highlight underline helpers', () => {
  const rects: HighlightSourceRect[] = [
    { left: 10, top: 20, width: 40, height: 10 },
    { left: 52, top: 21, width: 35, height: 10 },
    { left: 320, top: 21, width: 80, height: 10 },
    { left: 10, top: 48, width: 60, height: 10 }
  ];

  it('deduplicates item indexes and merges adjacent text divs on the same line', () => {
    const underlines = buildUnderlineRects(rects, [0, 1, 1]);

    expect(underlines).toEqual([
      { left: 10, top: 32, width: 77, height: 2 }
    ]);
  });

  it('keeps different columns and different rows as separate underlines', () => {
    const underlines = buildUnderlineRects(rects, [0, 2, 3]);

    expect(underlines).toEqual([
      { left: 10, top: 31, width: 40, height: 2 },
      { left: 320, top: 32, width: 80, height: 2 },
      { left: 10, top: 59, width: 60, height: 2 }
    ]);
  });
});
