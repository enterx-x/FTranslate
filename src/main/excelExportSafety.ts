const MAX_FORMULA_LENGTH = 4096;
const DANGEROUS_FORMULA_FUNCTIONS = [
  'CALL',
  'EXEC',
  'FILTERXML',
  'HYPERLINK',
  'IMAGE',
  'IMPORTDATA',
  'IMPORTHTML',
  'IMPORTXML',
  'REGISTER.ID',
  'RTD',
  'WEBSERVICE'
];

export type ExcelExportCellValue = string | { formula: string };

export function shouldExportAsExcelFormula(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('=')) {
    return false;
  }

  const formula = trimmed.slice(1).trimStart();
  if (!formula || formula.length > MAX_FORMULA_LENGTH || /[\u0000-\u001f\u007f]/u.test(formula)) {
    return false;
  }

  const upperFormula = formula.toUpperCase();
  if (/^(?:CMD|COMMAND|POWERSHELL|MSHTA|WSCRIPT|CSCRIPT)\s*[|!]/u.test(upperFormula)) {
    return false;
  }
  if (/(?:^|[^A-Z0-9_.])(?:https?|file|ftp):\/\//iu.test(formula)) {
    return false;
  }

  return !DANGEROUS_FORMULA_FUNCTIONS.some((functionName) =>
    new RegExp(`(?:^|[^A-Z0-9_.])${escapeRegExp(functionName)}\\s*\\(`, 'iu').test(formula)
  );
}

export function toExcelExportCellValue(value: string): ExcelExportCellValue {
  const text = typeof value === 'string' ? value : '';
  if (!shouldExportAsExcelFormula(text)) {
    return text;
  }

  return { formula: text.trim().slice(1) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
