import { describe, expect, it } from 'vitest';
import { getRelativeTranslationIndex, getTranslationItemAt } from './useAiTranslation';
import type { TranslationDocument } from '../lib/translation';

describe('getTranslationItemAt', () => {
  it('returns the requested translation item or null when out of range', () => {
    const document: TranslationDocument = {
      kind: 'json',
      items: [
        { section: '摘要', original: 'first', translation: '第一段' },
        { section: '摘要', original: 'second', translation: '第二段' }
      ]
    };

    expect(getTranslationItemAt(document, 1)?.original).toBe('second');
    expect(getTranslationItemAt(document, 10)).toBeNull();
    expect(getTranslationItemAt(null, 0)).toBeNull();
  });
});

describe('getRelativeTranslationIndex', () => {
  it('keeps paragraph navigation inside document bounds', () => {
    expect(getRelativeTranslationIndex(2, 5, 1)).toBe(3);
    expect(getRelativeTranslationIndex(4, 5, 1)).toBe(4);
    expect(getRelativeTranslationIndex(0, 5, -1)).toBe(0);
    expect(getRelativeTranslationIndex(0, 0, 1)).toBe(0);
  });
});
