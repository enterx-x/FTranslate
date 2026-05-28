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
  chineseTitle: 'Chinese title',
  englishTitle: 'A Robotic Foundation Model',
  journal: 'arXiv',
  authors: 'Author A',
  year: '2026',
  notes: 'Focus on safety constraints and reproducibility.',
  lastOpenedAt: '2026-05-28T00:00:00.000Z',
  lastPage: 2
};

describe('sheet cell AI prompt', () => {
  it('asks AI to fill only the selected cell using paper and row context', () => {
    const prompt = buildSheetCellPrompt({
      paper,
      columnHeader: 'Innovation',
      cellAddress: 'D2',
      currentCellText: 'Existing summary',
      neighborRowValues: {
        Title: 'Chinese title',
        Method: 'VLA foundation model'
      }
    });

    expect(prompt.systemPrompt).toContain('科研论文研究表格助手');
    expect(prompt.userPrompt).toContain('目标单元格：D2 / Innovation');
    expect(prompt.userPrompt).toContain('当前单元格已有内容：Existing summary');
    expect(prompt.userPrompt).toContain('Method：VLA foundation model');
    expect(prompt.userPrompt).toContain('A Robotic Foundation Model');
    expect(prompt.userPrompt).toContain('只输出该单元格内容');
    expect(prompt.userPrompt).not.toContain('Markdown table');
  });

  it('builds a strict JSON prompt for multiple selected cells', () => {
    const prompt = buildSheetCellsPrompt({
      paper,
      cells: [
        {
          rowIndex: 1,
          columnIndex: 3,
          cellAddress: 'D2',
          columnHeader: 'Innovation',
          currentCellText: '',
          neighborRowValues: { Title: 'Chinese title' }
        },
        {
          rowIndex: 1,
          columnIndex: 4,
          cellAddress: 'E2',
          columnHeader: 'Limitations',
          currentCellText: '',
          neighborRowValues: { Title: 'Chinese title' }
        }
      ]
    });

    expect(prompt.systemPrompt).toContain('JSON 数组');
    expect(prompt.userPrompt).toContain('D2 / Innovation');
    expect(prompt.userPrompt).toContain('E2 / Limitations');
    expect(prompt.userPrompt).toContain('"cellAddress"');
  });

  it('parses single-cell text and JSON responses', () => {
    const cells = [
      {
        rowIndex: 1,
        columnIndex: 3,
        cellAddress: 'D2',
        columnHeader: 'Innovation',
        currentCellText: '',
        neighborRowValues: {}
      }
    ];

    expect(
      parseSheetCellsAiResponse('```json\n[{"cellAddress":"D2","value":"new model"}]\n```', cells)
    ).toEqual([{ cellAddress: 'D2', value: 'new model' }]);
    expect(parseSheetCellsAiResponse('{"cellAddress":"D2","value":"object style"}', cells)).toEqual([
      { cellAddress: 'D2', value: 'object style' }
    ]);
    expect(parseSheetCellsAiResponse('plain cell text', cells)).toEqual([
      { cellAddress: 'D2', value: 'plain cell text' }
    ]);
  });

  it('maps single-cell JSON replies back to the requested address', () => {
    const cells = [
      {
        rowIndex: 1,
        columnIndex: 3,
        cellAddress: 'D2',
        columnHeader: 'Innovation',
        currentCellText: '',
        neighborRowValues: {}
      }
    ];

    expect(
      parseSheetCellsAiResponse('{"cellAddress":"Z9","value":"Use the only selected cell"}', cells)
    ).toEqual([{ cellAddress: 'D2', value: 'Use the only selected cell' }]);
  });

  it('normalizes multi-cell JSON replies to the requested selection', () => {
    const cells = [
      {
        rowIndex: 1,
        columnIndex: 3,
        cellAddress: 'D2',
        columnHeader: 'Innovation',
        currentCellText: '',
        neighborRowValues: {}
      },
      {
        rowIndex: 1,
        columnIndex: 4,
        cellAddress: 'E2',
        columnHeader: 'Limitations',
        currentCellText: '',
        neighborRowValues: {}
      }
    ];

    expect(
      parseSheetCellsAiResponse(
        '[{"cellAddress":"E2","value":"second"},{"cellAddress":"Z9","value":"ignore me"}]',
        cells
      )
    ).toEqual([
      { cellAddress: 'D2', value: '' },
      { cellAddress: 'E2', value: 'second' }
    ]);
  });
});
