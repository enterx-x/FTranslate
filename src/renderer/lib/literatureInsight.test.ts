import { describe, expect, it } from 'vitest';
import {
  buildLiteratureGapPrompt,
  appendLiteratureInsightHistory,
  completeLiteratureInsightRun,
  createLiteratureInsightRunState,
  describeLiteratureInsightAction,
  failLiteratureInsightRun,
  normalizeLiteratureInsightHistory,
  normalizeLiteratureInsightRunState,
  updateLiteratureInsightRunProgress,
  parseLiteratureGapResponse
} from './literatureInsight';
import type { PaperRecord } from './papers';

const paper: PaperRecord = {
  id: 'paper-1',
  pdfPath: 'D:/paper.pdf',
  pdfName: 'paper.pdf',
  translationPath: '',
  translationName: '',
  chineseTitle: '低层控制论文',
  englishTitle: 'PILOT: Low-level Control',
  journal: 'arXiv',
  authors: 'Author A',
  year: '2026',
  notes: '关注复杂地形、低层控制、安全约束。',
  lastOpenedAt: '2026-05-28T00:00:00.000Z',
  lastPage: 1
};

describe('literature gap insight prompt', () => {
  it('asks for recurring unresolved gaps and one verifiable research idea', () => {
    const prompt = buildLiteratureGapPrompt({
      papers: [
        {
          paper,
          rowValues: {
            创新点: '感知融合控制',
            局限点: '真实机器人泛化不足'
          },
          fallbackContextText: 'The method struggles in unseen cluttered scenes.'
        }
      ]
    });

    expect(prompt.systemPrompt).toContain('跨论文研究洞察');
    expect(prompt.systemPrompt).toContain('拒绝模块堆砌');
    expect(prompt.userPrompt).toContain('反复出现');
    expect(prompt.userPrompt).toContain('一直没解决');
    expect(prompt.userPrompt).toContain('明确科学问题');
    expect(prompt.userPrompt).toContain('可验证技术路线');
    expect(prompt.userPrompt).toContain('实验方案');
    expect(prompt.userPrompt).toContain('PILOT: Low-level Control');
    expect(prompt.userPrompt).toContain('真实机器人泛化不足');
  });

  it('cleans code fences from AI insight responses', () => {
    expect(parseLiteratureGapResponse('```markdown\n## 缺口\n内容\n```')).toBe('## 缺口\n内容');
  });

  it('describes progress and fallback scope for literature insight actions', () => {
    expect(
      describeLiteratureInsightAction({
        selectedPaperCount: 0,
        linkedPaperCount: 3,
        isRunning: false,
        isAiBusy: false
      })
    ).toMatchObject({
      disabled: false,
      label: 'AI 大观分析全部 3 篇',
      scopeText: '未选中绑定行，将分析全部 3 篇已绑定论文。'
    });

    expect(
      describeLiteratureInsightAction({
        selectedPaperCount: 2,
        linkedPaperCount: 3,
        isRunning: true,
        isAiBusy: true
      })
    ).toMatchObject({
      disabled: true,
      label: 'AI 大观分析中...',
      scopeText: '正在综合分析 2 篇选中论文。'
    });
  });

  it('persists literature insight progress and restores stale runs as interrupted', () => {
    const running = createLiteratureInsightRunState(2, 1000);
    const updated = updateLiteratureInsightRunProgress(running, 'running 12s', 12_000);
    const completed = completeLiteratureInsightRun(updated, 'final insight', 20_000);
    const failed = failLiteratureInsightRun(updated, 'request failed', 21_000);
    const stale = normalizeLiteratureInsightRunState(updated, 40 * 60 * 1000, 30 * 60 * 1000);

    expect(running).toMatchObject({
      status: 'running',
      paperCount: 2,
      progress: expect.stringContaining('2')
    });
    expect(updated).toMatchObject({
      status: 'running',
      progress: 'running 12s'
    });
    expect(completed).toMatchObject({
      status: 'completed',
      progress: '',
      result: 'final insight'
    });
    expect(failed).toMatchObject({
      status: 'failed',
      progress: 'request failed',
      error: 'request failed'
    });
    expect(stale).toMatchObject({
      status: 'interrupted',
      paperCount: 2,
      progress: expect.stringContaining('中断')
    });
  });

  it('stores newest literature insight history entries first with a bounded list', () => {
    const existing = normalizeLiteratureInsightHistory([
      {
        id: 'old',
        title: 'Old run',
        paperCount: 1,
        provider: 'kimi',
        model: 'kimi-k2.5',
        createdAt: 1000,
        result: 'old result'
      }
    ]);

    const next = appendLiteratureInsightHistory(
      existing,
      {
        title: 'New run',
        paperCount: 2,
        provider: 'openai',
        model: 'gpt-5.1',
        createdAt: 2000,
        result: 'new result',
        webSearchUsed: true
      },
      1
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      title: 'New run',
      paperCount: 2,
      provider: 'openai',
      model: 'gpt-5.1',
      createdAt: 2000,
      result: 'new result',
      webSearchUsed: true
    });
    expect(next[0].id).toContain('insight-2000');
  });
});
