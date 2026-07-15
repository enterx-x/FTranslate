import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PdfTranslationProgressBar } from './PdfTranslationProgressBar';

describe('PdfTranslationProgressBar', () => {
  it('renders page and percentage progress as an accessible determinate bar', () => {
    const html = renderToStaticMarkup(
      <PdfTranslationProgressBar
        message="PDF 翻译进度：38%，15/39 页"
        isBusy
      />
    );

    expect(html).toContain('aria-valuenow="38"');
    expect(html).toContain('width:38%');
    expect(html).toContain('已处理 15 / 39 页');
  });

  it('renders preparation as an indeterminate progress bar', () => {
    const html = renderToStaticMarkup(
      <PdfTranslationProgressBar message="正在准备生成中文 PDF..." isBusy />
    );

    expect(html).toContain('is-indeterminate');
    expect(html).not.toContain('aria-valuenow');
  });
});
