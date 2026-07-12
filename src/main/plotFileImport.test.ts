import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { PlotFileImportService } from './plotFileImport';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('plot file import service', () => {
  it('requires dialog authorization before reading CSV', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plot-file-'));
    roots.push(root);
    const filePath = path.join(root, 'data.csv');
    await writeFile(filePath, 'method,score\nPPO,0.8');
    const service = new PlotFileImportService();
    await expect(service.read({ filePath })).rejects.toThrow(/授权/);
    await service.authorize(filePath);
    expect((await service.read({ filePath })).rows).toEqual([['PPO', 0.8]]);
  });

  it('lists and reads the selected Excel worksheet without executing formulas', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plot-file-'));
    roots.push(root);
    const filePath = path.join(root, 'data.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('First').addRows([['x', 'y'], [1, 2]]);
    workbook.addWorksheet('Results').addRows([['algorithm', 'score'], ['SAC', 0.7]]);
    await workbook.xlsx.writeFile(filePath);
    const service = new PlotFileImportService();
    expect((await service.authorize(filePath)).sheets).toEqual(['First', 'Results']);
    expect((await service.read({ filePath, sheetName: 'Results' })).rows).toEqual([['SAC', 0.7]]);
  });

  it('keeps the first numeric Excel row as data when the file has no header', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plot-file-'));
    roots.push(root);
    const filePath = path.join(root, 'gdp.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('GDP').addRows([[1985, 577.38], [1986, 671.25], [1987, 758.04]]);
    await workbook.xlsx.writeFile(filePath);
    const service = new PlotFileImportService();
    await service.authorize(filePath);
    const table = await service.read({ filePath, sheetName: 'GDP' });
    expect(table.columns.map((column) => column.label)).toEqual(['列 A', '列 B']);
    expect(table.rows).toEqual([[1985, 577.38], [1986, 671.25], [1987, 758.04]]);
  });

  it('lets the user explicitly override header detection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plot-file-'));
    roots.push(root);
    const filePath = path.join(root, 'values.csv');
    await writeFile(filePath, '1985,577.38\n1986,671.25');
    const service = new PlotFileImportService();
    await service.authorize(filePath);
    const noHeader = await service.read({ filePath, headerRow: 0 });
    const firstRowHeader = await service.read({ filePath, headerRow: 1 });
    expect(noHeader.rows).toHaveLength(2);
    expect(firstRowHeader.columns.map((column) => column.label)).toEqual(['1985', '577.38']);
    expect(firstRowHeader.rows).toEqual([[1986, 671.25]]);
  });
});
