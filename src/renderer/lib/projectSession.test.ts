import { describe, expect, it } from 'vitest';
import { buildFreshPdfSessionState } from './projectSession';

describe('project session state', () => {
  it('clears translation artifacts when opening a fresh source PDF', () => {
    expect(buildFreshPdfSessionState()).toEqual({
      translationDocument: null,
      aiCacheDocument: null,
      currentParagraphIndex: 0,
      aiParagraphIndex: 0,
      showTranslation: false,
      isEditing: false,
      editingText: ''
    });
  });
});
