import { describe, expect, it } from 'vitest';
import { shouldPersistRecentProject } from './useRecentProject';

describe('shouldPersistRecentProject', () => {
  it('persists only when a pdf or translation path exists', () => {
    expect(shouldPersistRecentProject({})).toBe(false);
    expect(shouldPersistRecentProject({ aiCachePath: 'cache.json' })).toBe(false);
    expect(shouldPersistRecentProject({ pdfPath: 'paper.pdf' })).toBe(true);
    expect(shouldPersistRecentProject({ translationPath: 'translation.json' })).toBe(true);
  });
});
