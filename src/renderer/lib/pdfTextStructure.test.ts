import { describe, expect, it } from 'vitest';
import { buildPdfPageOutline, type PositionedPdfTextItem } from './pdfTextStructure';

function item(str: string, x: number, y: number, width = 120, height = 10): PositionedPdfTextItem {
  return { str, x, y, width, height, page: 1 };
}

describe('PDF text structure extraction', () => {
  it('rebuilds reading order for two-column academic pages', () => {
    const outline = buildPdfPageOutline(1, [
      item('right column later', 330, 120),
      item('left column first', 60, 120),
      item('left column second', 60, 140),
      item('right column final', 330, 140)
    ]);

    expect(outline.map((block) => block.original)).toEqual([
      'left column first left column second',
      'right column later right column final'
    ]);
  });

  it('classifies headings, formulas, captions, and paragraphs', () => {
    const outline = buildPdfPageOutline(2, [
      item('I. INTRODUCTION', 180, 80, 160, 14),
      item('x_t = f(x, u) + epsilon', 80, 130, 180, 10),
      item('Fig. 1: Robot examples.', 80, 170, 180, 9),
      item('Foundation models work on the principle that generalist capabilities emerge.', 80, 220)
    ]);

    expect(outline.map((block) => block.type)).toEqual([
      'heading',
      'formula',
      'caption',
      'paragraph'
    ]);
    expect(outline[0].section).toBe('I. INTRODUCTION');
    expect(outline.every((block) => block.page === 2)).toBe(true);
    expect(outline.every((block) => block.sourceHash)).toBe(true);
  });

  it('joins hyphenated line breaks within one paragraph', () => {
    const outline = buildPdfPageOutline(3, [
      item('Cross-embodiment generaliza-', 60, 100),
      item('tion is important for robot learning.', 60, 113)
    ]);

    expect(outline[0].original).toBe(
      'Cross-embodiment generalization is important for robot learning.'
    );
  });
});
