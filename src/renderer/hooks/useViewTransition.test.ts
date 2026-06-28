import { describe, expect, it } from 'vitest';
import { buildAppMainClassName } from './useViewTransition';

describe('buildAppMainClassName', () => {
  it('adds the transition class without leaving empty class tokens', () => {
    expect(buildAppMainClassName('reader-main', true)).toBe(
      'app-main reader-main is-view-transitioning'
    );
    expect(buildAppMainClassName('', false)).toBe('app-main');
  });
});
