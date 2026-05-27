import { describe, expect, it } from 'vitest';
import { buildPaperCellPrompt } from './paperCellAi';
import type { PaperRecord } from './papers';

const paper: PaperRecord = {
  id: 'paper-1',
  pdfPath: 'D:/paper.pdf',
  pdfName: 'paper.pdf',
  translationPath: 'D:/translation.json',
  translationName: 'translation.json',
  chineseTitle: '机器人基础模型',
  englishTitle: 'A Robotic Foundation Model',
  journal: 'arXiv',
  authors: 'Author A',
  year: '2026',
  notes: '关注安全强化学习和 CBF。',
  sheetCells: {
    innovation: '旧创新点'
  },
  lastOpenedAt: '2026-05-27T10:00:00.000Z',
  lastPage: 3
};

describe('paper spreadsheet AI cell prompt', () => {
  it('builds a concise prompt for filling one research spreadsheet cell', () => {
    const prompt = buildPaperCellPrompt({
      paper,
      field: 'limitations',
      contextText: 'The method requires large robot datasets and diverse tasks.'
    });

    expect(prompt.systemPrompt).toContain('科研论文阅读表格助手');
    expect(prompt.userPrompt).toContain('目标单元格：局限点');
    expect(prompt.userPrompt).toContain('A Robotic Foundation Model');
    expect(prompt.userPrompt).toContain('The method requires large robot datasets');
    expect(prompt.userPrompt).toContain('只输出该单元格内容');
  });

  it('clips long paper context before sending it to AI', () => {
    const prompt = buildPaperCellPrompt({
      paper,
      field: 'innovation',
      contextText: 'x'.repeat(12000)
    });

    expect(prompt.userPrompt.length).toBeLessThan(9000);
    expect(prompt.userPrompt).toContain('旧创新点');
  });
});
