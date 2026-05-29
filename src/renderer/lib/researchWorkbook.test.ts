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

  it('keeps blank tail rows when the user only changed their row heights', () => {
    const univerData = toUniverWorkbookData(buildDefaultResearchWorkbook());
    const sheet = univerData.sheets[univerData.sheetOrder[0]];
    sheet.rowData = {
      ...(sheet.rowData ?? {}),
      5: { h: 64 }
    };

    const restored = fromUniverWorkbookData(univerData);
    const roundTrip = toUniverWorkbookData(restored);
    const roundTripSheet = roundTrip.sheets[roundTrip.sheetOrder[0]];

    expect(restored.rows).toHaveLength(6);
    expect(restored.rows[5].height).toBe(64);
    expect(roundTripSheet.rowData?.[5]?.h).toBe(64);
  });

  it('stores stable row ids in snapshot metadata so bindings survive row insertions', () => {
    const seeded = ensurePaperRow(buildDefaultResearchWorkbook(), [], basePaper);
    const workbook = {
      ...seeded.workbook,
      rows: seeded.workbook.rows.map((row, index) =>
        index === seeded.rowIndex ? { ...row, id: 'linked-paper-1' } : row
      )
    };
    const univerData = toUniverWorkbookData(workbook);
    const sheet = univerData.sheets[univerData.sheetOrder[0]];
    const originalRowData = sheet.rowData ?? {};
    const originalCellData = sheet.cellData ?? {};

    expect((originalRowData[1] as { fTranslateRowId?: string } | undefined)?.fTranslateRowId).toBe('linked-paper-1');

    sheet.rowCount = (sheet.rowCount ?? 0) + 1;
    sheet.rowData = {
      ...originalRowData,
      1: {},
      2: originalRowData[1]
    };
    sheet.cellData = {
      ...originalCellData,
      1: {},
      2: originalCellData[1]
    };

    const restored = fromUniverWorkbookData(univerData);

    expect(restored.rows[1].id).toBe('row-1');
    expect(restored.rows[2].id).toBe('linked-paper-1');
    expect(getResearchCellText(restored, 2, 0)).toBe(basePaper.pdfName);
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

  it('restores used rows even when snapshot rowCount is smaller than the actual data', () => {
    const workbook = setResearchCellText(buildDefaultResearchWorkbook(), 5, 3, 'deep row value');
    const univerData = toUniverWorkbookData(workbook);
    const sheet = univerData.sheets[univerData.sheetOrder[0]];
    sheet.rowCount = 2;

    const restored = fromUniverWorkbookData(univerData);

    expect(restored.rows).toHaveLength(6);
    expect(getResearchCellText(restored, 5, 3)).toBe('deep row value');
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
  it('remaps imported style ids so existing workbook formatting is not overwritten', () => {
    const current = fromUniverWorkbookData({
      id: 'research-workbook',
      name: 'current-book',
      appVersion: '0.24.0',
      locale: 'zhCN',
      styles: {
        sharedStyle: { cl: { rgb: '#ff0000' } }
      },
      sheetOrder: ['sheet-1'],
      sheets: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'current-sheet',
          cellData: {
            0: { 0: { v: 'Header', t: 1 } },
            1: { 0: { v: 'current', t: 1, s: 'sharedStyle' } }
          },
          rowData: {
            0: { fTranslateRowId: 'header' },
            1: { fTranslateRowId: 'row-1' }
          },
          columnData: { 0: { w: 180 } },
          rowCount: 20,
          columnCount: 10,
          zoomRatio: 1,
          scrollTop: 0,
          scrollLeft: 0,
          defaultColumnWidth: 120,
          defaultRowHeight: 28,
          mergeData: [],
          rowHeader: { width: 46 },
          columnHeader: { height: 26 },
          showGridlines: 1,
          rightToLeft: 0
        }
      }
    } as never);
    const imported = fromUniverWorkbookData({
      id: 'research-workbook',
      name: 'imported-book',
      appVersion: '0.24.0',
      locale: 'zhCN',
      styles: {
        sharedStyle: { cl: { rgb: '#0000ff' } }
      },
      sheetOrder: ['sheet-1'],
      sheets: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'imported-sheet',
          cellData: {
            0: { 0: { v: 'Header', t: 1 } },
            1: { 0: { v: 'imported', t: 1, s: 'sharedStyle' } }
          },
          rowData: {
            0: { fTranslateRowId: 'header' },
            1: { fTranslateRowId: 'row-1' }
          },
          columnData: { 0: { w: 180 } },
          rowCount: 20,
          columnCount: 10,
          zoomRatio: 1,
          scrollTop: 0,
          scrollLeft: 0,
          defaultColumnWidth: 120,
          defaultRowHeight: 28,
          mergeData: [],
          rowHeader: { width: 46 },
          columnHeader: { height: 26 },
          showGridlines: 1,
          rightToLeft: 0
        }
      }
    } as never);

    const merged = appendResearchWorkbookSheets(current, imported);
    const snapshot = toUniverWorkbookData(merged);
    const currentSheet = snapshot.sheets[snapshot.sheetOrder[0]];
    const importedSheet = snapshot.sheets[snapshot.sheetOrder[1]];
    const currentStyleId = currentSheet.cellData?.[1]?.[0]?.s;
    const importedStyleId = importedSheet.cellData?.[1]?.[0]?.s;

    expect(currentStyleId).toBe('sharedStyle');
    expect(snapshot.styles?.[String(currentStyleId)]).toMatchObject({ cl: { rgb: '#ff0000' } });
    expect(importedStyleId).not.toBe(currentStyleId);
    expect(snapshot.styles?.[String(importedStyleId)]).toMatchObject({ cl: { rgb: '#0000ff' } });
  });
});
