import { describe, expect, it } from 'vitest';
import {
  buildSheetCellPrompt,
  buildSheetCellsPrompt,
  parseSheetCellsAiResponse
} from './sheetCellAi';
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
      }
    });

    expect(prompt.systemPrompt).toContain('科研论文研究表格助手');
    expect(prompt.userPrompt).toContain('目标单元格：D2 / 创新点');
    expect(prompt.userPrompt).toContain('当前单元格已有内容：已有摘要');
    expect(prompt.userPrompt).toContain('方法：VLA foundation model');
    expect(prompt.userPrompt).toContain('A Robotic Foundation Model');
    expect(prompt.userPrompt).toContain('只输出该单元格内容');
    expect(prompt.userPrompt).not.toContain('Markdown 表格');
  });

  it('builds a strict JSON prompt for multiple selected cells', () => {
    const prompt = buildSheetCellsPrompt({
      paper,
      cells: [
        {
          rowIndex: 1,
          columnIndex: 3,
          cellAddress: 'D2',
          columnHeader: '创新点',
          currentCellText: '',
          neighborRowValues: { 中文标题: '机器人基础模型' }
        },
        {
          rowIndex: 1,
          columnIndex: 4,
          cellAddress: 'E2',
          columnHeader: '局限点',
          currentCellText: '',
          neighborRowValues: { 中文标题: '机器人基础模型' }
        }
      ]
    });

    expect(prompt.systemPrompt).toContain('JSON 数组');
    expect(prompt.userPrompt).toContain('D2 / 创新点');
    expect(prompt.userPrompt).toContain('E2 / 局限点');
    expect(prompt.userPrompt).toContain('"cellAddress"');
  });

  it('parses multi-cell JSON responses and strips code fences', () => {
    const cells = [
      {
        rowIndex: 1,
        columnIndex: 3,
        cellAddress: 'D2',
        columnHeader: '创新点',
        currentCellText: '',
        neighborRowValues: {}
      }
    ];

    expect(
      parseSheetCellsAiResponse('```json\n[{"cellAddress":"D2","value":"提出新模型"}]\n```', cells)
    ).toEqual([{ cellAddress: 'D2', value: '提出新模型' }]);
    expect(parseSheetCellsAiResponse('{"cellAddress":"D2","value":"对象格式"}', cells)).toEqual([
      { cellAddress: 'D2', value: '对象格式' }
    ]);
    expect(parseSheetCellsAiResponse('单元格文本', cells)).toEqual([
      { cellAddress: 'D2', value: '单元格文本' }
    ]);
  });
});
