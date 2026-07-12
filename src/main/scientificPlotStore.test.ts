import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultScientificPlotSpec, type PlotDataTable } from '../shared/scientificPlot';
import { ScientificPlotStore } from './scientificPlotStore';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function createStore(): Promise<ScientificPlotStore> {
  const root = await mkdtemp(path.join(tmpdir(), 'ftranslate-plot-store-'));
  roots.push(root);
  return new ScientificPlotStore(root, {
    now: () => '2026-07-12T00:00:00.000Z',
    randomId: () => 'imported-copy'
  });
}

const data: PlotDataTable = {
  id: 'data-1',
  source: { kind: 'generated', name: 'fixture' },
  columns: [{ id: 'x', label: 'x', type: 'number' }],
  rows: [[1], [2]],
  createdAt: '2026-07-12T00:00:00.000Z'
};

describe('scientific plot project store', () => {
  it('creates, atomically saves, lists and reloads a project with an immutable raw snapshot', async () => {
    const store = await createStore();
    const spec = createDefaultScientificPlotSpec('plot-1');
    await store.createProject(spec, data);
    spec.title = '修改后的标题';
    await store.saveSpec(spec);

    expect((await store.listProjects())[0]).toMatchObject({ id: 'plot-1', title: '修改后的标题' });
    expect((await store.loadProject('plot-1')).data?.rows).toEqual([[1], [2]]);
    expect(JSON.parse(await readFile(path.join(store.rootPath, 'plot-1', 'data', 'raw', 'data.json'), 'utf8')).rows).toEqual([[1], [2]]);
  });

  it('rejects project and artifact path traversal', async () => {
    const store = await createStore();
    await expect(store.loadProject('../outside')).rejects.toThrow(/project id/i);
    await store.createProject(createDefaultScientificPlotSpec('safe'), data);
    await expect(store.writeArtifact('safe', '../escape.txt', 'bad')).rejects.toThrow(/artifact path/i);
  });

  it('excludes data from a share package unless explicitly requested', async () => {
    const store = await createStore();
    await store.createProject(createDefaultScientificPlotSpec('private'), data);
    const privatePackage = await store.exportFplot('private');
    const completePackage = await store.exportFplot('private', { includeRawData: true });

    expect(store.inspectFplot(privatePackage).files.some((file) => file.startsWith('data/'))).toBe(false);
    expect(store.inspectFplot(completePackage).files).toContain('data/raw/data.json');
  });

  it('imports a package as a new project instead of overwriting a collision', async () => {
    const store = await createStore();
    await store.createProject(createDefaultScientificPlotSpec('plot-1'), data);
    const archive = await store.exportFplot('plot-1', { includeRawData: true });
    const imported = await store.importFplot(archive);

    expect(imported.projectId).toBe('imported-copy');
    expect((await store.loadProject('plot-1')).spec.id).toBe('plot-1');
    expect((await store.loadProject('imported-copy')).data?.rows).toEqual([[1], [2]]);
  });
});
