import { describe, expect, it } from 'vitest';
import { getErrorBoundaryMessage } from './ErrorBoundary';

describe('getErrorBoundaryMessage', () => {
  it('uses concrete error messages when available', () => {
    expect(getErrorBoundaryMessage(new Error('chunk failed'))).toBe('chunk failed');
  });

  it('falls back to a user-facing message for unknown errors', () => {
    expect(getErrorBoundaryMessage('failed')).toBe('页面加载失败，请返回后重试。');
  });
});
