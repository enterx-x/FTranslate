import { describe, expect, it } from 'vitest';
import { buildOfficialFindFragments, buildOfficialFindQuery } from './pdfFindQuery';

describe('PDF.js find query builder', () => {
  it('keeps all searchable sentences instead of truncating long paragraphs', () => {
    const text = Array.from({ length: 7 }, (_, index) => {
      return `Sentence ${index + 1} contains enough words to be a searchable PDF paragraph fragment.`;
    }).join(' ');

    expect(buildOfficialFindQuery(text)).toHaveLength(7);
    expect(buildOfficialFindFragments(text)).toHaveLength(7);
  });
});
