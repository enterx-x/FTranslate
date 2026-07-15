import { describe, expect, it } from 'vitest';
import { formatMobileArxivHttpError } from './mobileArxiv';

describe('mobile arXiv HTTP errors', () => {
  it('shows the proxy explanation instead of a bare HTTP 502', () => {
    expect(formatMobileArxivHttpError(503, JSON.stringify({
      error: 'arXiv 暂时繁忙，已尝试备用检索；请稍后点击刷新。'
    }))).toBe('arXiv 暂时繁忙，已尝试备用检索；请稍后点击刷新。');
  });

  it('uses a concise retry message for non-JSON gateway failures', () => {
    expect(formatMobileArxivHttpError(502, '<html>bad gateway</html>'))
      .toBe('arXiv 暂时繁忙（HTTP 502），请稍后点击刷新。');
  });
});
