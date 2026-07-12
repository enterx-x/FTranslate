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
});
