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
    ['experimentMatrix', 'experimentMatrix'],
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

  it('keeps the daily reading loop as the only default navigation surface', () => {
    expect(getSidebarNavigationItems().map((item) => item.section)).toEqual([
      'workspace',
      'library',
      'arxiv',
      'reader',
      'settings'
    ]);
    expect(getSidebarNavigationItems().map((item) => item.label)).toEqual([
      '今日',
      '论文库',
      'arXiv 检索',
      'PDF 阅读',
      '设置'
    ]);
  });

  it('does not expose retired research modules in the visible navigation', () => {
    const visibleSections = getSidebarNavigationItems().map((item) => item.section);
    const visibleLabels = getSidebarNavigationItems().map((item) => item.label);

    expect(visibleSections).not.toContain('experimentMatrix');
    expect(visibleSections).not.toContain('researchSheet');
    expect(visibleSections).not.toContain('knowledgeGraph');
    expect(visibleSections).not.toContain('presentation');
    expect(visibleSections).not.toContain('paperTutor');
    expect(visibleSections).not.toContain('ai');
    expect(visibleLabels).not.toContain('实验矩阵');
    expect(visibleLabels).not.toContain('研究表格');
    expect(visibleLabels).not.toContain('证据图谱');
    expect(visibleLabels).not.toContain('组会 PPT');
    expect(visibleLabels).not.toContain('论文导师');
    expect(visibleLabels).not.toContain('AI 助手');
  });

  it('dispatches each section through the configured handler map', () => {
    const calls: AppSidebarSection[] = [];
    const handlers = createSidebarNavigationHandlers({
      activeSection: 'workspace',
      onOpenWorkspace: () => calls.push('workspace'),
      onOpenExperimentMatrix: () => calls.push('experimentMatrix'),
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

  it('organizes the visible loop into daily, reading, and utility groups', () => {
    expect(getSidebarNavigationItems().map((item) => item.group)).toEqual([
      'overview',
      'reading',
      'reading',
      'reading',
      'utility'
    ]);
  });
});
