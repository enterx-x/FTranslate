import { describe, expect, it } from 'vitest';
import { getSidebarNavigationTarget, type AppSidebarSection } from './AppSidebar';

describe('AppSidebar navigation targets', () => {
  it.each([
    ['workspace', 'workspace'],
    ['library', 'library'],
    ['researchSheet', 'researchSheet'],
    ['reader', 'reader'],
    ['ai', 'ai'],
    ['settings', 'settings']
  ] as const satisfies ReadonlyArray<readonly [AppSidebarSection, AppSidebarSection]>)(
    'maps %s to %s',
    (section, expected) => {
      expect(getSidebarNavigationTarget(section)).toBe(expected);
    }
  );
});
