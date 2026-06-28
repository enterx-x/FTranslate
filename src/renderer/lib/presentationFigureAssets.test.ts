import { describe, expect, it } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PresentationFigureCropBox } from './presentationOutline';
import {
  extractNativePdfImagesFromRenderedPage,
  findNonWhitePixelBounds,
  selectNativePdfImageForCropBox,
  selectNativePdfImagesForCropBox,
  mergePdfFigureAssetUpdate
} from './presentationFigureAssets';

const cropBox: PresentationFigureCropBox = {
  x: 40,
  y: 120,
  width: 520,
  height: 260,
  pageWidth: 612,
  pageHeight: 792
};

describe('presentationFigureAssets native image selection', () => {
  it('keeps resolved native images when PDF.js records extra image coordinates', () => {
    installMockCanvasDocument();
    const rgba = new Uint8ClampedArray(80 * 60 * 4).fill(255);
    const images = extractNativePdfImagesFromRenderedPage(
      {
        imageCoordinates: new Float32Array([
          0.1, 0.1, 0.1, 0.35, 0.42, 0.1,
          0.6, 0.6, 0.6, 0.75, 0.75, 0.6
        ])
      },
      {
        fnArray: [pdfjsLib.OPS.paintInlineImageXObject],
        argsArray: [[{ width: 80, height: 60, kind: 3, data: rgba }]]
      },
      2,
      600,
      800
    );

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      pageNumber: 2,
      pixelWidth: 80,
      pixelHeight: 60,
      bbox: {
        x: 60,
        y: 80,
        width: 192,
        height: 200,
        pageWidth: 600,
        pageHeight: 800
      }
    });
  });

  it('skips tiny embedded images before materializing data URLs', () => {
    const canvasMock = installMockCanvasDocument();
    const rgba = new Uint8ClampedArray(24 * 24 * 4).fill(255);
    const images = extractNativePdfImagesFromRenderedPage(
      {
        imageCoordinates: new Float32Array([
          0.1, 0.1, 0.1, 0.14, 0.14, 0.1
        ])
      },
      {
        fnArray: [pdfjsLib.OPS.paintInlineImageXObject],
        argsArray: [[{ width: 24, height: 24, kind: 3, data: rgba }]]
      },
      1,
      600,
      800
    );

    expect(images).toHaveLength(0);
    expect(canvasMock.getCreatedCanvasCount()).toBe(0);
  });

  it('selects a substantial embedded PDF image inside the inferred figure crop', () => {
    const selected = selectNativePdfImageForCropBox(
      [
        {
          id: 'tiny-logo',
          pageNumber: 1,
          bbox: { x: 46, y: 126, width: 24, height: 24, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,tiny',
          mimeType: 'image/png',
          pixelWidth: 24,
          pixelHeight: 24
        },
        {
          id: 'method-figure',
          pageNumber: 1,
          bbox: { x: 88, y: 152, width: 430, height: 190, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,figure',
          mimeType: 'image/png',
          pixelWidth: 1280,
          pixelHeight: 720
        }
      ],
      cropBox
    );

    expect(selected?.id).toBe('method-figure');
  });

  it('rejects tiny or barely-overlapping embedded images so the crop fallback can preserve vector figures', () => {
    const selected = selectNativePdfImageForCropBox(
      [
        {
          id: 'outside-image',
          pageNumber: 1,
          bbox: { x: 410, y: 650, width: 120, height: 80, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,outside',
          mimeType: 'image/png',
          pixelWidth: 320,
          pixelHeight: 240
        },
        {
          id: 'small-icon',
          pageNumber: 1,
          bbox: { x: 90, y: 150, width: 30, height: 28, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,icon',
          mimeType: 'image/png',
          pixelWidth: 60,
          pixelHeight: 56
        }
      ],
      cropBox
    );

    expect(selected).toBeNull();
  });

  it('selects multiple embedded panels inside the same figure crop for native composition', () => {
    const selected = selectNativePdfImagesForCropBox(
      [
        {
          id: 'panel-a',
          pageNumber: 1,
          bbox: { x: 70, y: 150, width: 145, height: 110, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,a',
          mimeType: 'image/png',
          pixelWidth: 640,
          pixelHeight: 480
        },
        {
          id: 'panel-b',
          pageNumber: 1,
          bbox: { x: 230, y: 150, width: 145, height: 110, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,b',
          mimeType: 'image/png',
          pixelWidth: 640,
          pixelHeight: 480
        },
        {
          id: 'panel-c',
          pageNumber: 1,
          bbox: { x: 390, y: 150, width: 145, height: 110, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,c',
          mimeType: 'image/png',
          pixelWidth: 640,
          pixelHeight: 480
        },
        {
          id: 'page-logo',
          pageNumber: 1,
          bbox: { x: 500, y: 700, width: 30, height: 25, pageWidth: 612, pageHeight: 792 },
          dataUrl: 'data:image/png;base64,logo',
          mimeType: 'image/png',
          pixelWidth: 80,
          pixelHeight: 70
        }
      ],
      cropBox
    );

    expect(selected.map((image) => image.id)).toEqual(['panel-a', 'panel-b', 'panel-c']);
  });

  it('finds tight content bounds inside a mostly blank page crop', () => {
    const width = 120;
    const height = 80;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    paintRect(pixels, width, 32, 20, 48, 30, [22, 32, 44, 255]);

    const bounds = findNonWhitePixelBounds(pixels, width, height, { padding: 5 });

    expect(bounds).toEqual({
      x: 27,
      y: 15,
      width: 58,
      height: 40
    });
  });

  it('merges a progressive figure image update without dropping other candidates', () => {
    const base = [
      buildFigureCandidate('fig-1'),
      buildFigureCandidate('fig-2')
    ];
    const updated = {
      ...base[1],
      imageDataUrl: 'data:image/png;base64,updated',
      imageMimeType: 'image/png' as const,
      imageExtractionMethod: 'page-crop' as const,
      cropStatus: 'image-ready' as const
    };

    expect(mergePdfFigureAssetUpdate(base, updated)).toEqual([base[0], updated]);
  });
});

function buildFigureCandidate(imageId: string) {
  return {
    imageId,
    pageNumber: 1,
    caption: imageId,
    source: 'pdf-caption' as const,
    suggestedSlide: 'method' as const,
    figureKind: 'method' as const,
    selected: true,
    cropStatus: 'caption-only' as const
  };
}

function paintRect(
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number]
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const index = (row * canvasWidth + column) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
}

function installMockCanvasDocument(): { getCreatedCanvasCount: () => number } {
  let createdCanvasCount = 0;
  const fakeDocument = {
    createElement: (tagName: string) => {
      if (tagName !== 'canvas') {
        throw new Error(`Unexpected element in test: ${tagName}`);
      }
      createdCanvasCount += 1;
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4)
          }),
          putImageData: () => undefined,
          drawImage: () => undefined,
          fillRect: () => undefined,
          set fillStyle(_value: string) {}
        }),
        toDataURL: () => 'data:image/png;base64,mocked'
      };
    }
  };
  (globalThis as unknown as { document: typeof fakeDocument }).document = fakeDocument;
  return {
    getCreatedCanvasCount: () => createdCanvasCount
  };
}
