import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PresentationFigureCandidate } from '../lib/presentationOutline';
import { PdfFigureWorkspaceDialog, summarizePdfFigureAssets } from './PdfFigureAssetsPanel';

describe('summarizePdfFigureAssets', () => {
  it('counts ready, native, composite, and crop figure assets in one pass', () => {
    const figures = [
      buildFigure('a', 'native-image'),
      buildFigure('b', 'native-image-composite'),
      buildFigure('c', 'page-crop'),
      buildFigure('d')
    ];

    expect(summarizePdfFigureAssets(figures)).toEqual({
      totalCount: 4,
      readyCount: 3,
      nativeCount: 1,
      compositeCount: 1,
      cropCount: 1
    });
  });
});

describe('PdfFigureWorkspaceDialog', () => {
  it('keeps the progress track mounted while idle so the content remains in the third grid row', () => {
    const markup = renderToStaticMarkup(createElement(PdfFigureWorkspaceDialog, {
      open: true,
      figures: [buildFigure('a', 'page-crop')],
      isExtracting: false,
      progress: null,
      onClose: () => undefined,
      onToggleFigure: () => undefined,
      onSetSelection: () => undefined,
      onNavigateToPage: () => undefined,
      onExtractPending: () => undefined,
      onRescan: () => undefined,
      onCancelExtraction: () => undefined,
      onExportSelected: () => undefined,
      onGeneratePresentation: () => undefined,
      onLoadPagePreview: async () => ({
        pageNumber: 1,
        pageWidth: 100,
        pageHeight: 100,
        pixelWidth: 350,
        pixelHeight: 350,
        dataUrl: 'data:image/png;base64,a'
      }),
      onApplyCrop: async () => undefined
    }));

    expect(markup).toContain('class="figure-assets-progress idle"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('class="figure-assets-layout"');
  });
});

function buildFigure(
  imageId: string,
  imageExtractionMethod?: PresentationFigureCandidate['imageExtractionMethod']
): PresentationFigureCandidate {
  return {
    imageId,
    pageNumber: 1,
    caption: `Figure ${imageId}`,
    source: 'pdf-caption',
    suggestedSlide: 'method',
    figureKind: 'method',
    selected: true,
    suggestedReason: '',
    cropStatus: imageExtractionMethod ? 'image-ready' : 'caption-only',
    imageDataUrl: imageExtractionMethod ? `data:image/png;base64,${imageId}` : undefined,
    imageExtractionMethod
  };
}
