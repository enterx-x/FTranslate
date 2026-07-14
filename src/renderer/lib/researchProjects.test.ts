import { describe, expect, it } from 'vitest';
import {
  buildDefaultResearchProject,
  buildProjectWorkspaceSnapshot,
  createResearchProject,
  ensureResearchProjects,
  linkCodeRepositoryPath,
  parseResearchProjects,
  serializeResearchProjects,
  updateProjectPaperMembership
} from './researchProjects';
import type { PaperRecord } from './papers';

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
    lastOpenedAt: '',
    lastPage: 1,
    tags: [],
    isPinned: false,
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('research project workspace model', () => {
  it('creates an independent project with normalized fields and a collision-safe id', () => {
    const existing = {
      ...buildDefaultResearchProject([], Date.UTC(2026, 0, 1)),
      id: 'research-project-mrkd2bk0'
    };

    expect(
      createResearchProject(
        [existing],
        {
          name: '  安全强化学习复现  ',
          description: '  对比 CBF 与 MPC 安全层  ',
          paperIds: ['paper-a', 'paper-a', '  paper-b  ']
        },
        Date.parse('2026-07-14T08:00:00.000Z')
      )
    ).toEqual({
      id: 'research-project-mrkd2bk0-2',
      name: '安全强化学习复现',
      description: '对比 CBF 与 MPC 安全层',
      status: 'active',
      paperIds: ['paper-a', 'paper-b'],
      codeRepositoryPaths: [],
      experimentIds: [],
      runtimeTaskIds: [],
      decisionLog: [],
      createdAt: '2026-07-14T08:00:00.000Z',
      updatedAt: '2026-07-14T08:00:00.000Z'
    });
    expect(createResearchProject([], { name: '   ' }, 1)).toBeNull();
  });

  it('creates a default local research project that links existing papers', () => {
    const papers = [
      makePaper('paper-a', { notes: 'method notes' }),
      makePaper('paper-b', { translatedPdfPath: 'C:/papers/paper-b-zh.pdf' })
    ];

    expect(buildDefaultResearchProject(papers, Date.UTC(2026, 1, 4, 10, 40))).toEqual({
      id: 'local-ai-rd-workspace',
      name: '本地 AI 科创研发项目',
      description: '把当前论文库、研究表格、知识图谱和 AI 助手组织为一个可追踪的研发闭环。',
      status: 'active',
      paperIds: ['paper-a', 'paper-b'],
      codeRepositoryPaths: [],
      experimentIds: [],
      runtimeTaskIds: [],
      decisionLog: [],
      createdAt: '2026-02-04T10:40:00.000Z',
      updatedAt: '2026-02-04T10:40:00.000Z'
    });
  });

  it('builds a workspace snapshot that connects project, papers, evidence and next actions', () => {
    const papers = [
      makePaper('with-notes', { notes: '复现计划', translatedPdfPath: 'C:/papers/with-notes-zh.pdf' }),
      makePaper('plain')
    ];
    const project = buildDefaultResearchProject(papers, Date.UTC(2026, 0, 1));

    expect(buildProjectWorkspaceSnapshot([project], papers)).toEqual({
      activeProject: project,
      projectCount: 1,
      linkedPaperCount: 2,
      evidenceCount: 2,
      dualPdfCount: 1,
      projectStatusText: 'Active',
      nextActions: [
        '生成 Paper-to-Method 方法卡',
        '把关键论文绑定到实验矩阵',
        '检查本地 AI Runtime 状态'
      ]
    });
  });

  it('round-trips valid projects and drops invalid persisted values', () => {
    const projects = [
      buildDefaultResearchProject([makePaper('paper-a')], Date.UTC(2026, 0, 1))
    ];
    const serialized = serializeResearchProjects(projects);

    expect(parseResearchProjects(serialized)).toEqual(projects);
    expect(parseResearchProjects('{"bad":true}')).toEqual([]);
    expect(parseResearchProjects(JSON.stringify([{ id: '', name: 'bad' }]))).toEqual([]);
  });

  it('merges code repository paths into the active project without duplicates', () => {
    const project = buildDefaultResearchProject([], Date.parse('2026-07-01T00:00:00.000Z'));
    const next = linkCodeRepositoryPath(project, 'D:\\repo', '2026-07-01T00:30:00.000Z');

    expect(next.codeRepositoryPaths).toEqual(['D:\\repo']);
    expect(next.updatedAt).toBe('2026-07-01T00:30:00.000Z');
    expect(linkCodeRepositoryPath(next, 'D:\\repo', '2026-07-01T01:00:00.000Z').codeRepositoryPaths).toEqual([
      'D:\\repo'
    ]);
    expect(linkCodeRepositoryPath(next, '   ', '2026-07-01T01:00:00.000Z')).toBe(next);
  });

  it('does not silently add every new paper to an existing project', () => {
    const paperA = makePaper('paper-a');
    const project = buildDefaultResearchProject([paperA], Date.UTC(2026, 0, 1));

    const [ensured] = ensureResearchProjects(
      [project],
      [paperA, makePaper('paper-b')],
      Date.UTC(2026, 0, 2)
    );

    expect(ensured).toBe(project);
    expect(ensured.paperIds).toEqual(['paper-a']);
  });

  it('adds and removes selected papers from one project without touching other projects', () => {
    const first = {
      ...buildDefaultResearchProject([makePaper('paper-a')], Date.UTC(2026, 0, 1)),
      id: 'project-a',
      name: 'Project A'
    };
    const second = {
      ...buildDefaultResearchProject([makePaper('paper-c')], Date.UTC(2026, 0, 1)),
      id: 'project-b',
      name: 'Project B'
    };

    const added = updateProjectPaperMembership(
      [first, second],
      'project-a',
      ['paper-b', 'paper-b'],
      'add',
      '2026-01-02T00:00:00.000Z'
    );

    expect(added[0]).toMatchObject({
      paperIds: ['paper-a', 'paper-b'],
      updatedAt: '2026-01-02T00:00:00.000Z'
    });
    expect(added[1]).toBe(second);

    const removed = updateProjectPaperMembership(
      added,
      'project-a',
      ['paper-a'],
      'remove',
      '2026-01-03T00:00:00.000Z'
    );
    expect(removed[0]).toMatchObject({
      paperIds: ['paper-b'],
      updatedAt: '2026-01-03T00:00:00.000Z'
    });
  });

  it('returns original project references for empty or no-op membership updates', () => {
    const project = buildDefaultResearchProject([makePaper('paper-a')], Date.UTC(2026, 0, 1));

    expect(updateProjectPaperMembership([project], 'missing', ['paper-a'], 'remove')[0]).toBe(project);
    expect(updateProjectPaperMembership([project], project.id, [], 'add')[0]).toBe(project);
    expect(updateProjectPaperMembership([project], project.id, ['paper-a'], 'add')[0]).toBe(project);
  });
});
