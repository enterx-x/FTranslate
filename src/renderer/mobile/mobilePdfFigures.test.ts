import { describe, expect, it } from 'vitest';
import type { ExtractedPdfBlock, PositionedPdfTextItem } from '../lib/pdfTextStructure';
import {
  buildPdfCaptionAnchors,
  detectPdfFigureRegions,
  type PdfPaintedImageBounds
} from './mobilePdfFigures';

function block(
  sourceHash: string,
  original: string,
  type: ExtractedPdfBlock['type'],
  x: number,
  y: number,
  width: number,
  height: number
): ExtractedPdfBlock {
  return {
    id: sourceHash,
    section: 'Page 9',
    original,
    translation: '',
    type,
    page: 9,
    sourceHash,
    bounds: { x, y, width, height, pageWidth: 612, pageHeight: 792 }
  };
}

function item(str: string, x: number, y: number, width: number, height: number): PositionedPdfTextItem {
  return { str, x, y, width, height, page: 1, pageWidth: 612, pageHeight: 792 };
}

describe('mobile PDF figure recovery', () => {
  it('groups a split PDF text line into a figure caption anchor', () => {
    const items: PositionedPdfTextItem[] = [
      { str: 'Fig.', x: 313, y: 157, width: 18, height: 10, page: 9, pageWidth: 612, pageHeight: 792 },
      { str: '6:', x: 334, y: 157, width: 12, height: 10, page: 9, pageWidth: 612, pageHeight: 792 },
      { str: 'Real-world results', x: 349, y: 157, width: 95, height: 10, page: 9, pageWidth: 612, pageHeight: 792 }
    ];

    expect(buildPdfCaptionAnchors(items, [])).toEqual([
      expect.objectContaining({ kind: 'figure', label: '6', original: 'Fig. 6: Real-world results' })
    ]);
  });

  it('finds a caption fragment even when graphic labels precede it on the same row', () => {
    const items = [
      item('Chart label', 24, 220, 86, 11),
      item('Fig. 1:', 54, 220, 40, 11),
      item('System overview', 98, 220, 120, 11)
    ];
    expect(buildPdfCaptionAnchors(items, [])).toEqual([
      expect.objectContaining({
        kind: 'figure',
        label: '1',
        original: 'Fig. 1: System overview',
        hasTextCaption: false
      })
    ]);
  });

  it('recovers two vector charts above their captions and hides chart-label text noise', () => {
    const blocks = [
      block('left-prose', 'The policy consistently improves performance across all contact-rich tasks.', 'paragraph', 54, 600, 245, 72),
      block('chart-label-6', 'Insert-T Book Towel Scoop Tea Average', 'paragraph', 329, 84, 210, 56),
      block('caption-6', 'Fig. 6: Real-world results on five contact-rich tasks.', 'caption', 313, 157, 245, 40),
      block('chart-label-7', 'w/o Touch and TD w/o TD Dream Raw Tactile Dream Latent Tactile', 'paragraph', 329, 218, 220, 78),
      block('caption-7', 'Fig. 7: Ablations of HTD.', 'caption', 313, 312, 245, 30),
      block('right-prose', 'These ablations show that predictive touch objectives improve control.', 'paragraph', 313, 352, 245, 60)
    ];
    const anchors = buildPdfCaptionAnchors([], blocks);
    const regions = detectPdfFigureRegions({
      page: 9,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors,
      imageBounds: []
    });

    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({
      captionHash: 'caption-6',
      hiddenTextHashes: ['chart-label-6']
    });
    expect(regions[0].bounds.y).toBeLessThan(70);
    expect(regions[0].bounds.y + regions[0].bounds.height).toBeLessThanOrEqual(153);
    expect(regions[1]).toMatchObject({
      captionHash: 'caption-7',
      hiddenTextHashes: ['chart-label-7']
    });
    expect(regions[1].bounds.y).toBeGreaterThanOrEqual(200);
    expect(regions[1].bounds.y + regions[1].bounds.height).toBeLessThanOrEqual(308);
  });

  it('uses the embedded raster union instead of including the page title above a figure', () => {
    const blocks = [
      block('title', 'Learning Versatile Humanoid Manipulation', 'heading', 100, 48, 410, 28),
      block('caption-1', 'Fig. 1: Our system enables versatile manipulation.', 'caption', 54, 612, 504, 36)
    ];
    const imageBounds: PdfPaintedImageBounds[] = [
      { x: 48, y: 177, width: 510, height: 421 }
    ];
    const regions = detectPdfFigureRegions({
      page: 1,
      pageWidth: 612,
      pageHeight: 792,
      blocks,
      anchors: buildPdfCaptionAnchors([], blocks),
      imageBounds
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].bounds.y).toBeGreaterThan(160);
    expect(regions[0].bounds.y).toBeLessThan(180);
    expect(regions[0].hiddenTextHashes).not.toContain('title');
  });
});
