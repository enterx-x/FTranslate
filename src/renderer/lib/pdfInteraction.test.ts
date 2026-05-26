import { describe, expect, it } from 'vitest';
import { buildAnchoredScrollPosition, getWheelZoomScale } from './pdfInteraction';

describe('PDF interaction helpers', () => {
  it('zooms in and out with a bounded wheel step', () => {
    expect(getWheelZoomScale(1.15, -120)).toBe(1.25);
    expect(getWheelZoomScale(1.15, 120)).toBe(1.05);
    expect(getWheelZoomScale(2.4, -120)).toBe(2.4);
    expect(getWheelZoomScale(0.6, 120)).toBe(0.6);
  });

  it('keeps the pointer anchored after scale changes', () => {
    expect(
      buildAnchoredScrollPosition({
        pageOffsetTop: 100,
        pageOffsetLeft: 20,
        pageWidth: 800,
        pageHeight: 1000,
        ratioX: 0.5,
        ratioY: 0.25,
        pointerXInContainer: 300,
        pointerYInContainer: 200
      })
    ).toEqual({
      scrollLeft: 120,
      scrollTop: 150
    });
  });
});
