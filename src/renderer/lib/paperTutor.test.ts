import { describe, expect, it } from 'vitest';
import {
  buildPaperTutorPrompt,
  appendPaperTutorSessionMessage,
  collectPaperTutorEvidence,
  createPaperTutorSession,
  buildTutorStarterQuestion,
  prioritizeActivePaperSelection,
  resolvePaperTutorSelection,
  sanitizePaperTutorAnswer,
  trimPaperTutorSessionsForStorage,
  type PaperTutorMessage
} from './paperTutor';
import type { PaperRecord } from './papers';
import type { PresentationFigureCandidate } from './presentationOutline';

const paperA: PaperRecord = {
  id: 'paper-a',
  pdfPath: 'a.pdf',
  pdfName: 'a.pdf',
  translationPath: '',
  translationName: '',
  chineseTitle: '触觉导航论文',
  englishTitle: 'Tactile Navigation with Contact-Rich Policies',
  journal: 'arXiv',
  authors: 'Ada Lovelace',
  year: '2026',
  notes: '方法输入为触觉和视觉观测，输出为低层控制动作。',
  lastOpenedAt: '2026-06-19T00:00:00.000Z',
  lastPage: 3,
  tags: [],
  isPinned: false,
  importedAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z'
};

const paperB: PaperRecord = {
  ...paperA,
  id: 'paper-b',
  pdfPath: 'b.pdf',
  pdfName: 'b.pdf',
  chineseTitle: '安全机器人导航论文',
  englishTitle: 'Safe Robot Navigation with CBF-MPC',
  notes: '强调 CBF safety filter 和 MPC 轨迹约束。'
};

const figure: PresentationFigureCandidate = {
  imageId: 'fig-1',
  pageNumber: 4,
  caption: 'Figure 2: Method overview. The encoder maps tactile images and robot states to an action policy.',
  source: 'pdf-caption',
  suggestedSlide: 'method',
  figureKind: 'method',
  cropStatus: 'image-ready',
  imageDataUrl: 'data:image/png;base64,abc'
};

describe('paperTutor', () => {
  it('builds seminar-style prompts grounded in papers, figures, and recent dialogue', () => {
    const history: PaperTutorMessage[] = [{ role: 'user', content: '我不知道这个模型输入是什么。' }];
    const prompt = buildPaperTutorPrompt({
      papers: [paperA, paperB],
      figures: [figure],
      pdfTextSnippets: ['The policy takes tactile images and proprioceptive states as input, then predicts low-level robot actions.'],
      history,
      userMessage: '请继续问我。'
    });

    expect(prompt.systemPrompt).toContain('组会导师');
    expect(prompt.systemPrompt).toContain('如果用户说不会');
    expect(prompt.systemPrompt).toContain('多篇论文');
    expect(prompt.userPrompt).toContain('Tactile Navigation');
    expect(prompt.userPrompt).toContain('CBF-MPC');
    expect(prompt.userPrompt).toContain('Method overview');
    expect(prompt.userPrompt).toContain('proprioceptive states');
    expect(prompt.userPrompt).toContain('输入是什么');
    expect(prompt.userPrompt).toContain('学生：我不知道这个模型输入是什么。');
  });

  it('injects selected-paper evidence bundles instead of sending generic chat context', () => {
    const prompt = buildPaperTutorPrompt({
      papers: [paperA],
      figures: [figure],
      evidenceBundles: [
        {
          paperId: paperA.id,
          paperTitle: paperA.englishTitle,
          figures: [figure],
          pdfTextSnippets: [
            'The method uses tactile images, proprioceptive states, and force-conditioned target pose correction.'
          ]
        }
      ],
      pdfTextSnippets: [],
      history: [],
      userMessage: '这个模块输入输出是什么？'
    });

    expect(prompt.systemPrompt).toContain('已经获得下面的论文证据包');
    expect(prompt.systemPrompt).toContain('必须优先使用证据包');
    expect(prompt.userPrompt).toContain('当前窗口选中论文');
    expect(prompt.userPrompt).toContain(`paperId=${paperA.id}`);
    expect(prompt.userPrompt).toContain('force-conditioned target pose correction');
    expect(prompt.userPrompt).toContain('Figure 1');
  });

  it('keeps tutor chat windows isolated by session', () => {
    const first = createPaperTutorSession({ papers: [paperA], now: '2026-06-20T00:00:00.000Z' });
    const second = createPaperTutorSession({ papers: [paperB], now: '2026-06-20T00:00:01.000Z' });
    const updatedFirst = appendPaperTutorSessionMessage(first, { role: 'user', content: '只问 A 论文。' });

    expect(updatedFirst.paperIds).toEqual([paperA.id]);
    expect(second.paperIds).toEqual([paperB.id]);
    expect(updatedFirst.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(0);
  });

  it('stores newest tutor chat windows first instead of keeping stale tail sessions', () => {
    const sessions = Array.from({ length: 14 }, (_, index) =>
      createPaperTutorSession({
        papers: [paperA],
        now: `2026-06-20T00:00:${String(index).padStart(2, '0')}.000Z`,
        id: `session-${index}`,
        messages: [{ role: 'user', content: `message-${index}` }]
      })
    ).reverse();

    const stored = trimPaperTutorSessionsForStorage(sessions, 12);

    expect(stored).toHaveLength(12);
    expect(stored[0].id).toBe('session-13');
    expect(stored.at(-1)?.id).toBe('session-2');
    expect(stored.some((session) => session.id === 'session-0')).toBe(false);
  });

  it('keeps recently updated tutor windows even when they are not first in memory', () => {
    const sessions = Array.from({ length: 14 }, (_, index) =>
      createPaperTutorSession({
        papers: [paperA],
        now: `2026-06-20T00:00:${String(index).padStart(2, '0')}.000Z`,
        id: `session-${index}`
      })
    );
    const recentlyUsedTailSession = {
      ...sessions[0],
      id: 'session-recent-tail',
      updatedAt: '2026-06-20T00:01:00.000Z'
    };

    const stored = trimPaperTutorSessionsForStorage([...sessions.slice(1), recentlyUsedTailSession], 12);

    expect(stored[0].id).toBe('session-recent-tail');
    expect(stored.some((session) => session.id === 'session-1')).toBe(false);
  });

  it('creates unique tutor chat window ids for rapid repeated new-window clicks', () => {
    const first = createPaperTutorSession({ papers: [paperA], now: '2026-06-20T00:00:00.000Z' });
    const second = createPaperTutorSession({ papers: [paperA], now: '2026-06-20T00:00:00.000Z' });

    expect(first.id).not.toBe(second.id);
  });

  it('filters figure and text evidence to the selected paper ids', () => {
    const otherFigure: PresentationFigureCandidate = {
      ...figure,
      imageId: 'fig-other',
      caption: 'Figure 9: unrelated ablation from another paper.'
    };
    const evidence = collectPaperTutorEvidence({
      papers: [paperA, paperB],
      selectedPaperIds: [paperB.id],
      activePaperId: paperA.id,
      activeFigures: [figure],
      activePdfTextSnippets: ['active paper A text'],
      evidenceByPaperId: {
        [paperB.id]: {
          figures: [otherFigure],
          pdfTextSnippets: ['selected paper B full-text evidence']
        }
      }
    });

    expect(evidence.figures).toEqual([otherFigure]);
    expect(evidence.pdfTextSnippets).toEqual(['selected paper B full-text evidence']);
    expect(evidence.bundles).toHaveLength(1);
    expect(evidence.bundles[0].paperId).toBe(paperB.id);
    expect(evidence.bundles[0].paperTitle).toContain('Safe Robot Navigation');
  });

  it('sanitizes leaked prompt scaffolding while preserving readable markdown tables', () => {
    const cleaned = sanitizePaperTutorAnswer([
      'SYSTEM PROMPT: 你是一个严格但建设性的组会导师。',
      '# 论文上下文',
      '标题：不应该被展示的内部上下文',
      '',
      '## 解答：力条件位姿修正模块',
      '| 项目 | 依据 | 结论 |',
      '| --- | --- | --- |',
      '| 输入 | Figure 2 caption | 力信号和目标位姿 |',
      '',
      '这部分应显示给用户。'
    ].join('\n'));

    expect(cleaned).not.toContain('SYSTEM PROMPT');
    expect(cleaned).not.toContain('# 论文上下文');
    expect(cleaned).toContain('| 项目 | 依据 | 结论 |');
    expect(cleaned).toContain('这部分应显示给用户。');
  });

  it('removes English prompt sections when the model echoes the user prompt context', () => {
    const cleaned = sanitizePaperTutorAnswer([
      '# Current selected papers',
      '## Paper 1',
      'title=Tactile Navigation with Contact-Rich Policies',
      'paperId=paper-a',
      '# Evidence bundles',
      '### Figures',
      '- Figure 1: page=4, caption=Method overview',
      '',
      '## Answer',
      '这篇论文的输入包括 tactile images 和 proprioceptive states。'
    ].join('\n'));

    expect(cleaned).not.toContain('Current selected papers');
    expect(cleaned).not.toContain('paperId=');
    expect(cleaned).not.toContain('Evidence bundles');
    expect(cleaned).toContain('## Answer');
    expect(cleaned).toContain('tactile images');
  });

  it('creates a concrete starter question from the selected paper and extracted figure', () => {
    expect(buildTutorStarterQuestion([paperA], [figure])).toContain('第 4 页图表');
    expect(buildTutorStarterQuestion([paperA], [figure])).toContain('输入是什么');
    expect(buildTutorStarterQuestion([paperA], [figure])).toContain('输出是什么');
  });

  it('falls back to the active paper when no papers are explicitly selected', () => {
    expect(resolvePaperTutorSelection([paperA, paperB], [], 'paper-b')).toEqual([paperB]);
    expect(resolvePaperTutorSelection([paperA, paperB], [], null)).toEqual([paperA]);
    expect(resolvePaperTutorSelection([paperA, paperB], ['paper-a'], 'paper-b')).toEqual([paperA]);
  });

  it('prioritizes the current reader paper over stale stored tutor selections', () => {
    expect(prioritizeActivePaperSelection(['paper-a', 'missing'], 'paper-b', [paperA, paperB], 5)).toEqual([
      'paper-b',
      'paper-a'
    ]);
    expect(prioritizeActivePaperSelection(['missing'], null, [paperA, paperB], 5)).toEqual([]);
  });
});
