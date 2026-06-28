import type { PresentationFigureCandidate } from '../lib/presentationOutline';

export interface PdfFigureAssetsSummary {
  totalCount: number;
  readyCount: number;
  nativeCount: number;
  compositeCount: number;
  cropCount: number;
}

interface PdfFigureAssetsPanelProps {
  figures: PresentationFigureCandidate[];
}

export function summarizePdfFigureAssets(figures: PresentationFigureCandidate[]): PdfFigureAssetsSummary {
  return figures.reduce<PdfFigureAssetsSummary>(
    (summary, figure) => {
      summary.totalCount += 1;
      if (figure.imageDataUrl) {
        summary.readyCount += 1;
      }
      if (figure.imageExtractionMethod === 'native-image') {
        summary.nativeCount += 1;
      }
      if (figure.imageExtractionMethod === 'native-image-composite') {
        summary.compositeCount += 1;
      }
      if (figure.imageExtractionMethod === 'page-crop') {
        summary.cropCount += 1;
      }
      return summary;
    },
    {
      totalCount: 0,
      readyCount: 0,
      nativeCount: 0,
      compositeCount: 0,
      cropCount: 0
    }
  );
}

export function PdfFigureAssetsPanel({ figures }: PdfFigureAssetsPanelProps) {
  if (figures.length === 0) {
    return null;
  }

  const summary = summarizePdfFigureAssets(figures);

  return (
    <section className="pdf-figure-assets" aria-label="PDF 提取图表">
      <header>
        <strong>PDF 图表</strong>
        <span>
          {summary.readyCount}/{summary.totalCount} 已提取
          {summary.nativeCount > 0 ? ` · 内嵌 ${summary.nativeCount}` : ''}
          {summary.compositeCount > 0 ? ` · 组合 ${summary.compositeCount}` : ''}
          {summary.cropCount > 0 ? ` · 裁剪 ${summary.cropCount}` : ''}
        </span>
      </header>
      <div className="pdf-figure-grid">
        {figures.slice(0, 8).map((figure) => (
          <article key={figure.imageId} className={figure.imageDataUrl ? '' : 'caption-only'}>
            {figure.imageDataUrl ? <img src={figure.imageDataUrl} alt={figure.caption} /> : <div>Caption</div>}
            <small className={`pdf-figure-source-badge ${
              figure.imageExtractionMethod === 'native-image' || figure.imageExtractionMethod === 'native-image-composite'
                ? 'native'
                : ''
            }`}>
              {figure.imageExtractionMethod === 'native-image'
                ? 'PDF 内嵌图像'
                : figure.imageExtractionMethod === 'native-image-composite'
                  ? 'PDF 内嵌图像组合'
                  : figure.imageExtractionMethod === 'page-crop'
                    ? '页面裁剪'
                    : '仅 caption'}
            </small>
            <strong>第 {figure.pageNumber} 页 · {figure.figureKind}</strong>
            <span>{figure.caption}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
