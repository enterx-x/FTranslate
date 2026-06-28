import { describe, expect, it } from 'vitest';
import { reducePdfTranslationProgress } from './usePdfTranslation';

describe('reducePdfTranslationProgress', () => {
  it('marks pdf translation busy only while progress is running', () => {
    const running = reducePdfTranslationProgress(
      { status: '', isBusy: false },
      { status: 'running', message: '正在处理第 1 页' }
    );
    const completed = reducePdfTranslationProgress(
      running,
      { status: 'completed', message: '完成' }
    );

    expect(running).toEqual({
      status: '正在处理第 1 页',
      isBusy: true
    });
    expect(completed).toEqual({
      status: '完成',
      isBusy: false
    });
  });
});
