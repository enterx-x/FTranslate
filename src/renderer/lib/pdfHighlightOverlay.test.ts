import { describe, expect, it } from 'vitest';
import { buildHighlightOverlayLines } from './pdfHighlightOverlay';

describe('PDF highlight overlay lines', () => {
  it('merges same visual text row fragments into one continuous underline', () => {
    const lines = buildHighlightOverlayLines(
      [
        { left: 20, top: 40, right: 48, bottom: 96, width: 28, height: 56 },
        { left: 49, top: 59, right: 62, bottom: 86, width: 13, height: 27 },
        { left: 63, top: 75, right: 70, bottom: 82, width: 7, height: 7 },
        { left: 71, top: 63, right: 84, bottom: 87, width: 13, height: 24 },
        { left: 86, top: 50, right: 742, bottom: 88, width: 656, height: 38 }
      ],
      { width: 820, height: 1100 }
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      left: 20,
      width: 722,
      height: 1
    });
  });

  it('keeps different visual rows separate and clamps them inside the page', () => {
    const lines = buildHighlightOverlayLines(
      [
        { left: -10, top: 40, right: 200, bottom: 80, width: 210, height: 40 },
        { left: 120, top: 95, right: 860, bottom: 140, width: 740, height: 45 }
      ],
      { width: 820, height: 1100 }
    );

    expect(lines).toHaveLength(2);
    expect(lines[0].left).toBe(0);
    expect(lines[1].width).toBe(700);
  });
});
