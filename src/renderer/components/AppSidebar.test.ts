import { describe, expect, it } from 'vitest';
import {
  createSidebarNavigationHandlers,
  getSidebarNavigationItems,
  getSidebarNavigationTarget,
  type AppSidebarSection
} from './AppSidebar';

describe('AppSidebar navigation targets', () => {
  it.each([
    ['workspace', 'workspace'],
    ['library', 'library'],
    ['researchSheet', 'researchSheet'],
    ['knowledgeGraph', 'knowledgeGraph'],
    ['presentation', 'presentation'],
    ['arxiv', 'arxiv'],
    ['reader', 'reader'],
    ['paperTutor', 'paperTutor'],
    ['ai', 'ai'],
    ['settings', 'settings']
  ] as const satisfies ReadonlyArray<readonly [AppSidebarSection, AppSidebarSection]>)(
    'maps %s to %s',
    (section, expected) => {
      expect(getSidebarNavigationTarget(section)).toBe(expected);
    }
  );

  it('uses clear research workflow labels instead of generic AI wording', () => {
    const labels = getSidebarNavigationItems().map((item) => item.label);

    expect(labels).toContain('论文导师');
    expect(labels).not.toContain('AI 问答');
  });

  it('dispatches each section through the configured handler map', () => {
    const calls: AppSidebarSection[] = [];
    const handlers = createSidebarNavigationHandlers({
      activeSection: 'workspace',
      onOpenWorkspace: () => calls.push('workspace'),
      onOpenLibrary: () => calls.push('library'),
      onOpenResearchSheet: () => calls.push('researchSheet'),
      onOpenKnowledgeGraph: () => calls.push('knowledgeGraph'),
      onOpenPresentation: () => calls.push('presentation'),
      onOpenArxiv: () => calls.push('arxiv'),
      onOpenReader: () => calls.push('reader'),
      onOpenPaperTutor: () => calls.push('paperTutor'),
      onOpenAi: () => calls.push('ai'),
      onOpenSettings: () => calls.push('settings')
    });

    handlers.reader();
    handlers.arxiv();
    handlers.settings();

    expect(calls).toEqual(['reader', 'arxiv', 'settings']);
  });
});
