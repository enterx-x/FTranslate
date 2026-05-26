export interface PdfCanvasDimensions {
  canvasWidth: number;
  canvasHeight: number;
  cssWidth: number;
  cssHeight: number;
  outputScale: number;
}

export function buildPdfCanvasDimensions(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number
): PdfCanvasDimensions {
  const cssWidth = Math.round(viewportWidth);
  const cssHeight = Math.round(viewportHeight);
  const outputScale = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;

  return {
    canvasWidth: Math.round(viewportWidth * outputScale),
    canvasHeight: Math.round(viewportHeight * outputScale),
    cssWidth,
    cssHeight,
    outputScale
  };
}
