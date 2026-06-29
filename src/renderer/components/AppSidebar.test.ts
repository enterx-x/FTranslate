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

  it('uses clear AI R&D workspace labels instead of generic legacy wording', () => {
    const labels = getSidebarNavigationItems().map((item) => item.label);

    expect(labels.slice(0, 4)).toEqual(['项目空间', '实验矩阵', '证据图谱', '组会 PPT']);
    expect(labels).toContain('项目空间');
    expect(labels).toContain('论文导师');
    expect(labels).not.toContain('工作台');
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
