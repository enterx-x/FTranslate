import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PaperRecord } from '../lib/papers';
import type { ResearchProject } from '../lib/researchProjects';
import { PaperLibraryPage } from './PaperLibraryPage';

function makePaper(id: string, overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id,
    pdfName: `${id}.pdf`,
    pdfPath: `C:/papers/${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: '',
    englishTitle: id,
    authors: '',
    journal: '',
    year: '',
    notes: '',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    lastPage: 1,
    tags: [],
    isPinned: false,
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function makeProject(paperIds: string[]): ResearchProject {
  return {
    id: 'project-a',
    name: '安全导航',
    description: '',
    status: 'active',
    paperIds,
    codeRepositoryPaths: [],
    experimentIds: [],
    runtimeTaskIds: [],
    decisionLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function renderPage(papers: PaperRecord[]): string {
  return renderToStaticMarkup(
    <PaperLibraryPage
      papers={papers}
      projects={[makeProject(papers.map((paper) => paper.id))]}
      onBackHome={vi.fn()}
      onNewProject={vi.fn()}
      onOpenPaper={vi.fn()}
      onOpenResearchSheet={vi.fn()}
      onUpdatePapers={vi.fn()}
      onRemovePapers={vi.fn()}
      onProjectsChange={vi.fn()}
    />
  );
}

describe('PaperLibraryPage', () => {
  it('renders navigation, visible sorting, a dense list, and the selected-paper inspector', () => {
    const html = renderPage([
      makePaper('paper-1', {
        englishTitle: 'Control Barrier Functions',
        authors: 'Ames et al.',
        year: '2017',
        tags: ['CBF', 'Safe RL'],
        totalPages: 20,
        lastPage: 8
      })
    ]);

    expect(html).toContain('data-paper-library-page');
    expect(html).toContain('data-paper-library-navigator');
    expect(html).toContain('data-paper-library-sort');
    expect(html).toContain('最近活动');
    expect(html).toContain('data-paper-library-row');
    expect(html).toContain('Control Barrier Functions');
    expect(html).toContain('data-paper-library-inspector');
    expect(html).toContain('data-paper-library-resume');
    expect(html).toContain('data-paper-library-tag-manage="cbf"');
    expect(html).toContain('40%');
  });

  it('renders a useful empty state without mounting list rows or a stale inspector', () => {
    const html = renderPage([]);

    expect(html).toContain('还没有论文记录');
    expect(html).toContain('导入第一篇论文');
    expect(html).not.toContain('data-paper-library-row');
    expect(html).not.toContain('data-paper-library-inspector');
  });
});
