import { describe, expect, it } from 'vitest';
import { buildSheetCellPrompt } from './sheetCellAi';
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
  notes: '关注安全约束和复现实验。',
  lastOpenedAt: '2026-05-28T00:00:00.000Z',
  lastPage: 2
};

describe('sheet cell AI prompt', () => {
  it('asks AI to fill only the selected cell using paper and row context', () => {
    const prompt = buildSheetCellPrompt({
      paper,
      columnHeader: '创新点',
      cellAddress: 'D2',
      currentCellText: '已有摘要',
      neighborRowValues: {
        中文标题: '机器人基础模型',
        方法: 'VLA foundation model'
      },
      paperContext: 'The paper proposes a steerable robotic foundation model.'
    });

    expect(prompt.systemPrompt).toContain('科研论文研究表格助手');
    expect(prompt.userPrompt).toContain('目标单元格：D2 / 创新点');
    expect(prompt.userPrompt).toContain('当前单元格已有内容：已有摘要');
    expect(prompt.userPrompt).toContain('方法：VLA foundation model');
    expect(prompt.userPrompt).toContain('A Robotic Foundation Model');
    expect(prompt.userPrompt).toContain('只输出该单元格内容');
    expect(prompt.userPrompt).not.toContain('Markdown 表格');
  });
});
