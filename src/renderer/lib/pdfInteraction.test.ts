import { describe, expect, it } from 'vitest';
import {
  buildAnchoredScrollPosition,
  getFitWidthScale,
  getPinchZoomScale,
  getWheelZoomScale
} from './pdfInteraction';

describe('PDF interaction helpers', () => {
  it('zooms in and out with a bounded wheel step', () => {
    expect(getWheelZoomScale(1.15, -120)).toBe(1.25);
    expect(getWheelZoomScale(1.15, 120)).toBe(1.05);
    expect(getWheelZoomScale(2.4, -120)).toBe(2.4);
    expect(getWheelZoomScale(0.35, 120)).toBe(0.35);
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

  it('maps a two-finger distance change to a bounded zoom scale', () => {
    expect(getPinchZoomScale(1, 100, 150)).toBe(1.5);
    expect(getPinchZoomScale(1.2, 120, 60)).toBe(0.6);
    expect(getPinchZoomScale(2.2, 100, 200)).toBe(2.4);
    expect(getPinchZoomScale(0.5, 0, 200)).toBe(0.5);
  });

  it('computes a fit-width scale from the rendered page size', () => {
    expect(getFitWidthScale(390, 612, 1, 24)).toBeCloseTo(0.598, 3);
    expect(getFitWidthScale(390, 1224, 2, 24)).toBeCloseTo(0.598, 3);
    expect(getFitWidthScale(0, 0, 0)).toBe(1);
  });
});
