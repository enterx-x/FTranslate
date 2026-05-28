import { describe, expect, it } from 'vitest';
import { buildLiteratureGapPrompt, parseLiteratureGapResponse } from './literatureInsight';
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
});
