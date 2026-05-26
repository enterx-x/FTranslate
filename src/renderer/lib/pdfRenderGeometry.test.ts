import { describe, expect, it } from 'vitest';
import { buildPdfCanvasDimensions } from './pdfRenderGeometry';

describe('PDF render geometry', () => {
  it('keeps CSS size stable while increasing canvas pixels for HiDPI screens', () => {
    expect(buildPdfCanvasDimensions(612.4, 792.6, 2)).toEqual({
      canvasWidth: 1225,
      canvasHeight: 1585,
      cssWidth: 612,
      cssHeight: 793,
      outputScale: 2
    });
  });

  it('falls back to 1x output scale when device pixel ratio is invalid', () => {
    expect(buildPdfCanvasDimensions(300, 200, 0)).toEqual({
      canvasWidth: 300,
      canvasHeight: 200,
      cssWidth: 300,
      cssHeight: 200,
      outputScale: 1
    });
  });
});
