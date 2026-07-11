import { describe, expect, it } from 'vitest';
import type { PaperRecord } from './papers';
import type { ResearchProject } from './researchProjects';
import {
  DEFAULT_PAPER_LIBRARY_PREFERENCES,
  DEFAULT_PAPER_LIBRARY_QUERY,
  applyPaperBulkAction,
  buildPaperLibraryView,
  buildPaperTagCatalog,
  deleteTagAcrossLibrary,
  getPaperProgress,
  getSelectionSummary,
  parsePaperLibraryViewPreferences,
  renameTagAcrossLibrary,
  serializePaperLibraryViewPreferences,
  sortPapers
} from './paperLibraryView';

function makePaper(id: string, overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id,
    pdfPath: `D:/${id}.pdf`,
    pdfName: `${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: '',
    englishTitle: id,
    journal: '',
    authors: '',
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

function makeProject(id: string, paperIds: string[]): ResearchProject {
  return {
    id,
    name: id,
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

describe('paper library view', () => {
  it('uses normalized AND semantics across searchable paper fields', () => {
    const papers = [
      makePaper('a', {
        englishTitle: 'Control Barrier Functions',
        authors: 'Ames',
        tags: ['Safe RL'],
        sheetCells: { method: 'Quadratic program' }
      }),
      makePaper('b', {
        englishTitle: 'Control Barrier Functions',
        authors: 'Other',
        tags: ['Safe RL']
      })
    ];

    expect(
      buildPaperLibraryView(papers, [], {
        ...DEFAULT_PAPER_LIBRARY_QUERY,
        search: '  barrier   AMES  '
      }).items.map((paper) => paper.id)
    ).toEqual(['a']);
    expect(
      buildPaperLibraryView(papers, [], {
        ...DEFAULT_PAPER_LIBRARY_QUERY,
        search: 'quadratic program'
      }).items.map((paper) => paper.id)
    ).toEqual(['a']);
  });

  it('filters multiple tags with AND semantics and ignores tag casing', () => {
    const papers = [
      makePaper('a', { tags: ['CBF', 'Safe RL'] }),
      makePaper('b', { tags: ['CBF'] })
    ];

    const result = buildPaperLibraryView(papers, [], {
      ...DEFAULT_PAPER_LIBRARY_QUERY,
      activeTags: ['cbf', 'SAFE RL']
    });

    expect(result.items.map((paper) => paper.id)).toEqual(['a']);
  });

  it('filters by project membership from the project source of truth', () => {
    const papers = [makePaper('a'), makePaper('b')];
    const projects = [makeProject('project-a', ['b'])];

    expect(
      buildPaperLibraryView(papers, projects, {
        ...DEFAULT_PAPER_LIBRARY_QUERY,
        projectId: 'project-a'
      }).items.map((paper) => paper.id)
    ).toEqual(['b']);
  });

  it.each([
    ['recent', [makePaper('recent', { lastOpenedAt: '2026-04-01T00:00:00.000Z' }), makePaper('never', { lastOpenedAt: '' })], ['recent']],
    ['needsOrganizing', [makePaper('needs', { englishTitle: '', pdfName: '', authors: '', year: '', tags: [] }), makePaper('ready', { authors: 'Author', year: '2026', tags: ['Tag'] })], ['needs']],
    ['pinned', [makePaper('pinned', { isPinned: true }), makePaper('plain')], ['pinned']],
    ['completed', [makePaper('completed', { completedAt: '2026-04-01T00:00:00.000Z' }), makePaper('reading')], ['completed']]
  ] as const)('supports the %s smart view', (smartView, papers, expectedIds) => {
    const result = buildPaperLibraryView([...papers], [makeProject('project', ['ready'])], {
      ...DEFAULT_PAPER_LIBRARY_QUERY,
      smartView
    });

    expect(result.items.map((paper) => paper.id)).toEqual([...expectedIds]);
  });

  it('sorts recent activity by the latest timestamp and keeps pinned papers first', () => {
    const result = sortPapers(
      [
        makePaper('old-pinned', {
          isPinned: true,
          importedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: '2026-01-01T00:00:00.000Z'
        }),
        makePaper('opened', { lastOpenedAt: '2026-03-01T00:00:00.000Z' }),
        makePaper('edited', { updatedAt: '2026-04-01T00:00:00.000Z' })
      ],
      'recentActivity',
      'desc'
    );

    expect(result.map((paper) => paper.id)).toEqual(['old-pinned', 'edited', 'opened']);
  });

  it.each(['title', 'year', 'importedAt', 'lastOpenedAt', 'progress'] as const)(
    'keeps unknown %s values last in both directions',
    (sortKey) => {
      const knownA = makePaper('a', {
        englishTitle: 'A',
        year: '2024',
        importedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
        totalPages: 10,
        lastPage: 2
      });
      const knownB = makePaper('b', {
        englishTitle: 'B',
        year: '2025',
        importedAt: '2026-02-01T00:00:00.000Z',
        lastOpenedAt: '2026-02-01T00:00:00.000Z',
        totalPages: 10,
        lastPage: 8
      });
      const unknown = makePaper('unknown', {
        pdfName: '',
        englishTitle: '',
        year: '',
        importedAt: '',
        updatedAt: '',
        lastOpenedAt: '',
        totalPages: undefined
      });

      expect(sortPapers([unknown, knownB, knownA], sortKey, 'asc').at(-1)?.id).toBe('unknown');
      expect(sortPapers([unknown, knownA, knownB], sortKey, 'desc').at(-1)?.id).toBe('unknown');
    }
  );

  it('keeps original order for stable ties', () => {
    const first = makePaper('first', { year: '2026' });
    const second = makePaper('second', { year: '2026' });

    expect(sortPapers([first, second], 'year', 'desc').map((paper) => paper.id)).toEqual([
      'first',
      'second'
    ]);
  });

  it('derives reading progress and completion without inventing unknown percentages', () => {
    expect(getPaperProgress(makePaper('unknown', { totalPages: undefined, lastPage: 8 }))).toBeUndefined();
    expect(getPaperProgress(makePaper('reading', { totalPages: 20, lastPage: 8 }))).toBe(0.4);
    expect(
      getPaperProgress(
        makePaper('complete', {
          totalPages: undefined,
          completedAt: '2026-01-02T00:00:00.000Z'
        })
      )
    ).toBe(1);
  });

  it('round-trips preferences and rejects invalid persisted values', () => {
    expect(parsePaperLibraryViewPreferences('{"sortKey":"bad"}')).toEqual(
      DEFAULT_PAPER_LIBRARY_PREFERENCES
    );
    expect(
      parsePaperLibraryViewPreferences(
        serializePaperLibraryViewPreferences({
          ...DEFAULT_PAPER_LIBRARY_PREFERENCES,
          density: 'comfortable'
        })
      ).density
    ).toBe('comfortable');
  });

  it('builds deterministic tag counts and reports hidden selections', () => {
    const papers = [
      makePaper('a', { tags: ['CBF'] }),
      makePaper('b', { tags: ['cbf', 'Safe RL'] })
    ];

    expect(buildPaperTagCatalog(papers)).toEqual([
      { key: 'cbf', label: 'CBF', count: 2 },
      { key: 'safe rl', label: 'Safe RL', count: 1 }
    ]);
    expect(getSelectionSummary(new Set(['a', 'b']), [papers[0]])).toEqual({
      total: 2,
      visible: 1,
      hidden: 1
    });
  });

  it('applies bulk organization actions without mutating input records', () => {
    const source = [makePaper('a'), makePaper('b')];
    const tagged = applyPaperBulkAction(
      source,
      new Set(['a']),
      { type: 'addTags', tags: [' CBF ', 'cbf'] },
      '2026-03-01T00:00:00.000Z'
    );
    const pinned = applyPaperBulkAction(
      tagged,
      new Set(['a']),
      { type: 'setPinned', value: true },
      '2026-03-02T00:00:00.000Z'
    );
    const completed = applyPaperBulkAction(
      pinned,
      new Set(['a']),
      { type: 'setCompleted', value: true },
      '2026-03-03T00:00:00.000Z'
    );

    expect(completed[0]).toMatchObject({
      tags: ['CBF'],
      isPinned: true,
      completedAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z'
    });
    expect(completed[1]).toBe(source[1]);
    expect(source[0]).toMatchObject({ tags: [], isPinned: false });
    expect(source[0].completedAt).toBeUndefined();

    const removed = applyPaperBulkAction(
      completed,
      new Set(['a']),
      { type: 'remove' },
      '2026-03-04T00:00:00.000Z'
    );
    expect(removed.map((paper) => paper.id)).toEqual(['b']);
  });

  it('renames and deletes a tag across the library with normalized matching', () => {
    const papers = [
      makePaper('a', { tags: ['CBF', 'Safe RL'] }),
      makePaper('b', { tags: ['cbf'] })
    ];
    const renamed = renameTagAcrossLibrary(
      papers,
      'cbf',
      'Control Barrier',
      '2026-03-01T00:00:00.000Z'
    );

    expect(renamed.map((paper) => paper.tags)).toEqual([
      ['Control Barrier', 'Safe RL'],
      ['Control Barrier']
    ]);
    expect(deleteTagAcrossLibrary(renamed, 'control barrier').map((paper) => paper.tags)).toEqual([
      ['Safe RL'],
      []
    ]);
  });

  it('derives 1,000 records within the agreed local performance budget', () => {
    const papers = Array.from({ length: 1_000 }, (_, index) =>
      makePaper(String(index), {
        englishTitle: `Paper ${index} Control`,
        authors: `Author ${index}`,
        tags: index % 2 ? ['CBF'] : ['Safe RL']
      })
    );
    const startedAt = performance.now();
    const result = buildPaperLibraryView(papers, [], {
      ...DEFAULT_PAPER_LIBRARY_QUERY,
      search: 'Control',
      sortKey: 'title'
    });

    expect(result.items).toHaveLength(1_000);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});
