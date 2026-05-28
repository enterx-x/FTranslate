import { describe, expect, it } from 'vitest';
import {
  RESEARCH_SHEET_COLUMNS,
  RESEARCH_SHEET_LINKS_KEY,
  RESEARCH_WORKBOOK_KEY,
  buildDefaultResearchWorkbook,
  ensurePaperRow,
  getResearchCellText,
  migrateLegacyPaperSheetCells,
  parseResearchSheetLinks,
  serializeResearchSheetLinks,
  setResearchCellText
} from './researchWorkbook';
import type { PaperRecord } from './papers';

const basePaper: PaperRecord = {
  id: 'paper-1',
  pdfPath: 'D:/paper.pdf',
  pdfName: 'paper.pdf',
  translationPath: 'D:/translation.json',
  translationName: 'translation.json',
  chineseTitle: '中文标题',
  englishTitle: 'English Title',
  journal: 'arXiv',
  authors: 'Author A',
  year: '2026',
  notes: '阅读笔记',
  lastOpenedAt: '2026-05-28T00:00:00.000Z',
  lastPage: 3
};

describe('research workbook model', () => {
  it('creates a frozen first row workbook with paper research columns', () => {
    const workbook = buildDefaultResearchWorkbook();

    expect(RESEARCH_WORKBOOK_KEY).toBe('pdfTranslationReader:researchWorkbook');
    expect(RESEARCH_SHEET_LINKS_KEY).toBe('pdfTranslationReader:researchSheetLinks');
    expect(workbook.sheetName).toBe('论文研究表');
    expect(workbook.freeze.ySplit).toBe(1);
    expect(RESEARCH_SHEET_COLUMNS.map((column) => column.label)).toEqual([
      '论文',
      '中文标题',
      '英文标题',
      '创新点',
      '局限点',
      '方法',
      '数据/任务',
      '指标/结果',
      '复现计划',
      '后续 idea',
      '备注'
    ]);
    expect(getResearchCellText(workbook, 0, 3)).toBe('创新点');
  });

  it('adds or reuses a row linked to a paper without duplicating rows', () => {
    const workbook = buildDefaultResearchWorkbook();
    const links = parseResearchSheetLinks(null);

    const first = ensurePaperRow(workbook, links, basePaper);
    const second = ensurePaperRow(first.workbook, first.links, basePaper);

    expect(first.rowIndex).toBe(1);
    expect(second.rowIndex).toBe(1);
    expect(getResearchCellText(second.workbook, 1, 1)).toBe('中文标题');
    expect(parseResearchSheetLinks(serializeResearchSheetLinks(second.links))[0]).toEqual({
      rowId: 'row-1',
      paperId: 'paper-1'
    });
  });

  it('migrates old paper sheetCells into the standalone workbook once', () => {
    const legacyPaper = {
      ...basePaper,
      sheetCells: {
        innovation: '提出 $L=\\sum_i x_i^2$ 约束。',
        limitations: '需要更多真实机器人实验。'
      }
    };

    const migrated = migrateLegacyPaperSheetCells(buildDefaultResearchWorkbook(), [], [legacyPaper]);
    const migratedAgain = migrateLegacyPaperSheetCells(migrated.workbook, migrated.links, [legacyPaper]);

    expect(getResearchCellText(migrated.workbook, 1, 3)).toBe('提出 $L=\\sum_i x_i^2$ 约束。');
    expect(getResearchCellText(migrated.workbook, 1, 4)).toBe('需要更多真实机器人实验。');
    expect(migratedAgain.workbook.rows).toHaveLength(migrated.workbook.rows.length);
  });

  it('edits arbitrary cells while preserving row and column structure', () => {
    const seeded = ensurePaperRow(buildDefaultResearchWorkbook(), [], basePaper);
    const updated = setResearchCellText(seeded.workbook, seeded.rowIndex, 10, '加入 CBF 对照实验');

    expect(getResearchCellText(updated, seeded.rowIndex, 10)).toBe('加入 CBF 对照实验');
    expect(getResearchCellText(seeded.workbook, seeded.rowIndex, 10)).toBe('阅读笔记');
  });
});
