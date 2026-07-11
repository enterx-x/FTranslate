import { describe, expect, it } from 'vitest';
import { readLegacyPapersWithSheetCells } from './useResearchWorkbook';
import type { PaperRecord } from '../lib/papers';

function makePaper(id: string, pdfPath = `C:/papers/${id}.pdf`): PaperRecord {
  return {
    id,
    pdfPath,
    pdfName: `${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: id,
    englishTitle: id,
    journal: '',
    authors: '',
    year: '',
    notes: '',
    lastOpenedAt: '',
    lastPage: 1,
    tags: [],
    isPinned: false,
    importedAt: '',
    updatedAt: ''
  };
}

describe('readLegacyPapersWithSheetCells', () => {
  it('links legacy sheet cells back to current paper records by id or pdf path', () => {
    const paperById = makePaper('paper-by-id');
    const paperByPath = makePaper('paper-by-path', 'C:/Papers/Mixed/Path.pdf');
    const rawValue = JSON.stringify([
      { id: 'paper-by-id', sheetCells: { innovation: '新方法' } },
      { pdfPath: 'c:/papers/mixed/path.pdf', sheetCells: { method: '路径匹配' } },
      { id: 'missing', sheetCells: { method: '跳过' } }
    ]);

    expect(readLegacyPapersWithSheetCells(rawValue, [paperById, paperByPath])).toEqual([
      { ...paperById, sheetCells: { innovation: '新方法' } },
      { ...paperByPath, sheetCells: { method: '路径匹配' } }
    ]);
  });
});
