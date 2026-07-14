export interface PdfCanvasDimensions {
  canvasWidth: number;
  canvasHeight: number;
  cssWidth: number;
  cssHeight: number;
  outputScale: number;
}

export interface PdfRenderSurfaceSnapshot {
  loadedPageCount: number;
  canvasSizes: ReadonlyArray<{ width: number; height: number }>;
  svgCount: number;
  imageSizes: ReadonlyArray<{ width: number; height: number }>;
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

export function isPdfRenderSurfaceReady(snapshot: PdfRenderSurfaceSnapshot): boolean {
  const hasSizedCanvas = snapshot.canvasSizes.some(({ width, height }) => width > 0 && height > 0);
  const hasSizedImage = snapshot.imageSizes.some(({ width, height }) => width > 0 && height > 0);

  // PDF.js may set data-loaded before it inserts or paints a render surface.
  // Keep loadedPageCount in the snapshot for diagnostics, but never use it as completion evidence.
  return hasSizedCanvas || snapshot.svgCount > 0 || hasSizedImage;
}
