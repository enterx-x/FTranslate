import { describe, expect, it } from 'vitest';
import { buildArxivApiUrl, normalizeArxivSearchQuery, type ArxivSearchRequest } from './arxiv';

function getSearchExpression(searchQuery: string): string {
  const request: ArxivSearchRequest = {
    searchQuery,
    category: '',
    start: 0,
    maxResults: 50,
    sortBy: 'comprehensive',
    sortOrder: 'descending'
  };
  return new URL(buildArxivApiUrl(request)).searchParams.get('search_query') ?? '';
}

describe('arXiv query builder', () => {
  it('does not mix search history or fixed latent robot keywords into a single Chinese tactile search', () => {
    const expression = getSearchExpression('触觉');

    expect(expression).toContain('ti:tactile');
    expect(expression).toContain('abs:haptic');
    expect(expression).not.toContain('ti:robot');
    expect(expression).not.toContain('abs:robot');
    expect(expression).not.toContain('robot navigation');
    expect(expression).not.toContain('reinforcement learning');
  });

  it('keeps multi-keyword searches broad while including all requested semantic terms', () => {
    const expression = getSearchExpression('tactile robot navigation');

    expect(expression).toContain('ti:tactile');
    expect(expression).toContain('ti:"robot navigation"');
    expect(expression).toContain('OR');
  });

  it('expands Chinese tactile searches into English tactile and haptic terms', () => {
    const normalized = normalizeArxivSearchQuery('触觉');

    expect(normalized.toLowerCase()).toContain('tactile');
    expect(normalized.toLowerCase()).toContain('haptic');
  });
});
