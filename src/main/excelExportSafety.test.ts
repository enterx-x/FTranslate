import { describe, expect, it } from 'vitest';
import { shouldExportAsExcelFormula, toExcelExportCellValue } from './excelExportSafety';

describe('excelExportSafety', () => {
  it('keeps ordinary formulas as formulas for user-authored workbook calculations', () => {
    expect(shouldExportAsExcelFormula('=SUM(A1:A3)')).toBe(true);
    expect(toExcelExportCellValue('=AVERAGE(B2:B4)')).toEqual({ formula: 'AVERAGE(B2:B4)' });
  });

  it('exports external-link and command-like formulas as inert text', () => {
    expect(shouldExportAsExcelFormula('=HYPERLINK("https://example.com","open")')).toBe(false);
    expect(shouldExportAsExcelFormula('=WEBSERVICE("https://example.com")')).toBe(false);
    expect(shouldExportAsExcelFormula("=cmd|' /C calc'!A0")).toBe(false);
    expect(toExcelExportCellValue('=HYPERLINK("https://example.com","open")')).toBe(
      '=HYPERLINK("https://example.com","open")'
    );
  });

  it('exports leading plus, minus, and at-sign payloads as inert text', () => {
    expect(toExcelExportCellValue('+cmd|/C calc!A0')).toBe('+cmd|/C calc!A0');
    expect(toExcelExportCellValue('-2+3')).toBe('-2+3');
    expect(toExcelExportCellValue('@SUM(A1:A2)')).toBe('@SUM(A1:A2)');
  });
});
