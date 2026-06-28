import { describe, expect, it } from 'vitest';
import type { PresentationFigureCandidate } from '../lib/presentationOutline';
import { summarizePdfFigureAssets } from './PdfFigureAssetsPanel';

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
