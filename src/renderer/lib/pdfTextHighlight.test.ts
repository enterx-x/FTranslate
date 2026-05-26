import { describe, expect, it } from 'vitest';
import { findTextItemMatches, normalizePdfSearchText } from './pdfTextHighlight';

describe('PDF text highlight matching', () => {
  it('normalizes whitespace, casing, punctuation, and line-break hyphenation', () => {
    expect(normalizePdfSearchText('Zero-\nshot  Cross-Embodiment π0.7')).toBe(
      'zeroshot crossembodiment π0 7'
    );
  });

  it('matches query text across multiple PDF text items', () => {
    const matches = findTextItemMatches(
      [
        { str: 'Foundation models work on' },
        { str: ' the principle that generalist' },
        { str: ' capabilities emerge from training.' }
      ],
      'models work on the principle that generalist capabilities'
    );

    expect(matches).toEqual([0, 1, 2]);
  });

  it('matches words split by PDF line-break hyphenation', () => {
    const matches = findTextItemMatches(
      [{ str: 'zero-' }, { str: 'shot cross-' }, { str: 'embodiment generalization' }],
      'zero-shot cross-embodiment'
    );

    expect(matches).toEqual([0, 1, 2]);
  });

  it('returns no matches when query text is not present', () => {
    const matches = findTextItemMatches(
      [{ str: 'The paper studies robot policies.' }],
      'language model scaling law'
    );

    expect(matches).toEqual([]);
  });
});
