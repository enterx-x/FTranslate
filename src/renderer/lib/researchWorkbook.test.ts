import { describe, expect, it } from 'vitest';
import {
  RESEARCH_SHEET_COLUMNS,
  RESEARCH_SHEET_LINKS_KEY,
  RESEARCH_WORKBOOK_KEY,
  buildDefaultResearchWorkbook,
  appendResearchWorkbookSheets,
  ensurePaperRow,
  fromUniverWorkbookData,
  isResearchCellStyleEnabled,
  getResearchCellText,
  migrateLegacyPaperSheetCells,
  parseResearchWorkbook,
  parseResearchSheetLinks,
  serializeResearchSheetLinks,
  setResearchCellStyle,
  setResearchCellText,
  toUniverWorkbookData
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

  it('creates blank rows on demand and preserves Univer style ids after snapshots', () => {
    const workbook = setResearchCellText(buildDefaultResearchWorkbook(), 8, 3, '远端行内容');
    const univerData = toUniverWorkbookData(workbook);
    const sheetId = univerData.sheetOrder[0];
    const sheet = univerData.sheets[sheetId];
    expect(sheet.cellData?.[8]?.[3]).toBeTruthy();
    sheet.cellData![8][3].s = 'custom-style';
    univerData.styles = {
      ...univerData.styles,
      'custom-style': { fs: 16, cl: { rgb: '#ff0000' }, ht: 2 }
    };

    const restored = fromUniverWorkbookData(univerData);

    expect(getResearchCellText(restored, 8, 3)).toBe('远端行内容');
    expect(restored.styles?.['custom-style']).toEqual({ fs: 16, cl: { rgb: '#ff0000' }, ht: 2 });
    expect(restored.rows[8].cells[3].style?.univerStyle).toBe('custom-style');
  });

  it('preserves row heights after saving a Univer workbook snapshot', () => {
    const workbook = setResearchCellText(buildDefaultResearchWorkbook(), 2, 3, 'custom row height');
    const univerData = toUniverWorkbookData(workbook);
    const sheet = univerData.sheets[univerData.sheetOrder[0]];
    sheet.rowData = {
      ...(sheet.rowData ?? {}),
      2: { h: 72 }
    };

    const restored = fromUniverWorkbookData(univerData);
    const roundTrip = toUniverWorkbookData(restored);
    const roundTripSheet = roundTrip.sheets[roundTrip.sheetOrder[0]];

    expect(restored.rows[2].height).toBe(72);
    expect(roundTripSheet.rowData?.[2]?.h).toBe(72);
  });

  it('preserves user-created columns when loading the local research workbook', () => {
    const workbook = buildDefaultResearchWorkbook();
    const parsed = parseResearchWorkbook(JSON.stringify({
      ...workbook,
      columns: [
        ...workbook.columns,
        { key: 'custom-11', label: 'My Custom Column', width: 210 }
      ],
      rows: workbook.rows.map((row) => ({
        ...row,
        cells: [...row.cells, { value: row.id === 'header' ? 'My Custom Column' : 'custom value' }]
      }))
    }));

    expect(parsed.columns.at(-1)).toEqual({
      key: 'custom-11',
      label: 'My Custom Column',
      width: 210
    });
    expect(parsed.rows[0].cells.at(-1)?.value).toBe('My Custom Column');
  });

  it('can toggle bold and italic off and back on without losing the cell value', () => {
    const seeded = setResearchCellText(buildDefaultResearchWorkbook(), 1, 3, '格式测试');
    const boldItalic = setResearchCellStyle(seeded, 1, 3, { bl: 1, it: 1 });
    const disabled = setResearchCellStyle(boldItalic, 1, 3, { bl: 0, it: 0 });
    const enabledAgain = setResearchCellStyle(disabled, 1, 3, { bl: 1, it: 1 });

    expect(getResearchCellText(enabledAgain, 1, 3)).toBe('格式测试');
    expect(isResearchCellStyleEnabled(disabled, 1, 3, 'bl')).toBe(false);
    expect(isResearchCellStyleEnabled(disabled, 1, 3, 'it')).toBe(false);
    expect(isResearchCellStyleEnabled(enabledAgain, 1, 3, 'bl')).toBe(true);
    expect(isResearchCellStyleEnabled(enabledAgain, 1, 3, 'it')).toBe(true);
    expect(enabledAgain.rows[1].cells[3].style?.univerStyle).toMatchObject({
      bl: 1,
      it: 1
    });
  });

  it('does not persist Univer padding columns as real workbook columns', () => {
    const workbook = setResearchCellText(buildDefaultResearchWorkbook(), 1, 3, 'kept value');
    const univerData = toUniverWorkbookData(workbook);

    const restored = fromUniverWorkbookData(univerData);

    expect(restored.columns).toHaveLength(workbook.columns.length);
    expect(restored.rows[0].cells).toHaveLength(workbook.columns.length);
    expect(restored.rows[1].cells).toHaveLength(workbook.columns.length);
    expect(getResearchCellText(restored, 1, 3)).toBe('kept value');
  });

  it('appends imported Excel sheets without replacing the current workbook', () => {
    const current = setResearchCellText(buildDefaultResearchWorkbook(), 1, 3, '保留当前工作表');
    const imported = setResearchCellText(
      {
        ...buildDefaultResearchWorkbook(),
        sheetName: '外部文献总览'
      },
      1,
      3,
      '导入工作表内容'
    );

    const merged = appendResearchWorkbookSheets(current, imported);
    const snapshot = toUniverWorkbookData(merged);

    expect(snapshot.sheetOrder).toHaveLength(2);
    expect(snapshot.sheets[snapshot.sheetOrder[0]].name).toBe('论文研究表');
    expect(snapshot.sheets[snapshot.sheetOrder[1]].name).toBe('外部文献总览');
    expect(getResearchCellText(merged, 1, 3)).toBe('保留当前工作表');
    expect(snapshot.sheets[snapshot.sheetOrder[1]].cellData?.[1]?.[3]?.v).toBe('导入工作表内容');
  });
});
