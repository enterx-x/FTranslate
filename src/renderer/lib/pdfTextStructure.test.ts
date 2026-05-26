import { describe, expect, it } from 'vitest';
import {
  buildPdfPageOutline,
  orderPositionedTextItemsForReading,
  type PositionedPdfTextItem
} from './pdfTextStructure';

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

  it('keeps zoomed body lines from the same paragraph as one candidate block', () => {
    const outline = buildPdfPageOutline(4, [
      item('Foundation models work on the principle that generalist capabilities', 60, 100, 280, 22),
      item('emerge from training on large and diverse datasets and then', 60, 132, 280, 22),
      item('transfer to many downstream robotic manipulation tasks.', 60, 164, 280, 22)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0].original).toBe(
      'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets and then transfer to many downstream robotic manipulation tasks.'
    );
  });

  it('does not merge body lines across columns', () => {
    const outline = buildPdfPageOutline(5, [
      item('Left column paragraph starts with enough academic content', 60, 100, 220, 12),
      item('and finishes this sentence in the left column.', 60, 118, 220, 12),
      item('Right column paragraph starts independently with enough content', 330, 100, 220, 12),
      item('and finishes this separate sentence in the right column.', 330, 118, 220, 12)
    ]);

    expect(outline.map((block) => block.original)).toEqual([
      'Left column paragraph starts with enough academic content and finishes this sentence in the left column.',
      'Right column paragraph starts independently with enough content and finishes this separate sentence in the right column.'
    ]);
  });

  it('filters front matter, author lists, and figure labels from AI extraction', () => {
    const outline = buildPdfPageOutline(1, [
      item('π0.7: a Steerable Generalist Robotic Foundation', 120, 40, 360, 18),
      item('Model with Emergent Capabilities', 160, 62, 320, 18),
      item('Bo Ai, Ali Amin, Richelle Aniceto, Ashwin Balakrishna, Greg Balke, Kevin Black', 90, 94, 460, 8),
      item('Robot Data pick up the knife chop the zucchini Demonstration Data close the microwave', 80, 190, 420, 8),
      item('Abstract—We present a new robotic foundation model, called π0.7, that can enable', 70, 520, 220, 9),
      item('strong out-of-the-box performance in a wide range of scenarios.', 70, 533, 220, 9)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0]).toMatchObject({
      section: 'Abstract',
      type: 'paragraph'
    });
    expect(outline[0].original).toBe(
      'We present a new robotic foundation model, called π0.7, that can enable strong out-of-the-box performance in a wide range of scenarios.'
    );
  });

  it('filters placeholder glyph noise and formula-like fragments from paragraph candidates', () => {
    const outline = buildPdfPageOutline(6, [
      item('p4□□□ R□□t □□□□ □□□□□', 80, 120, 260, 10),
      item('g_t = G_t,1, ..., G_t,k', 80, 150, 140, 10),
      item('This section describes each part of the prompt contained in the context C_t used by π0.7.', 80, 190, 320, 10)
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].original).toBe(
      'This section describes each part of the prompt contained in the context C_t used by π0.7.'
    );
  });

  it('orders positioned text items by academic reading order for matching', () => {
    const ordered = orderPositionedTextItemsForReading([
      item('right first', 330, 100),
      item('left first', 60, 100),
      item('right second', 330, 114),
      item('left second', 60, 114)
    ]);

    expect(ordered.map((orderedItem) => orderedItem.str)).toEqual([
      'left first',
      'left second',
      'right first',
      'right second'
    ]);
  });
});
