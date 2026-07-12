import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultScientificPlotSpec, type PlotDataTable } from '../shared/scientificPlot';
import { PlotRendererService, type PlotRuntimeResolver } from './plotRenderer';
import { ScientificPlotStore } from './scientificPlotStore';
import type { RuntimeCommandRunner } from './plotRuntimeManager';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const data: PlotDataTable = {
  id: 'data',
  source: { kind: 'generated', name: 'fixture' },
  columns: [{ id: 'x', label: 'x', type: 'number' }, { id: 'y', label: 'y', type: 'number' }],
  rows: [[1, 2], [2, 3]],
  createdAt: '2026-07-12T00:00:00.000Z'
};

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'ftranslate-renderer-'));
  roots.push(root);
  const store = new ScientificPlotStore(root);
  const spec = createDefaultScientificPlotSpec('plot-1');
  spec.encodings = { x: 'x', y: 'y' };
  await store.createProject(spec, data);
  const runtime: PlotRuntimeResolver = {
    detectAll: async () => [],
    getRuntimeCommand: (language) => language === 'python' ? { executable: 'python.exe', prefixArgs: [] } : undefined
  };
  return { root, store, spec, runtime };
}

describe('plot renderer service', () => {
  it('marks JavaScript jobs complete for renderer-side ECharts', async () => {
    const { store, spec, runtime } = await setup();
    const service = new PlotRendererService({ store, runtimeManager: runtime });
    const job = service.submit({ projectId: spec.id, spec, data });
    expect(job).toMatchObject({ status: 'succeeded', language: 'javascript', progress: 100 });
  });

  it('validates external preview artifacts and preserves stale success after a later failure', async () => {
    const { store, spec, runtime } = await setup();
    let fail = false;
    const runner: RuntimeCommandRunner = async (_executable, _args, options) => {
      if (fail) return { exitCode: 2, stdout: '', stderr: 'controlled failure' };
      const output = path.join(options?.cwd as string, 'output');
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'preview.svg'), '<svg></svg>');
      await writeFile(path.join(output, 'analysis-results.json'), '[]');
      await writeFile(path.join(output, 'render-manifest.json'), JSON.stringify({ language: 'python', chartType: 'line', preview: 'preview.svg' }));
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };
    const service = new PlotRendererService({ store, runtimeManager: runtime, commandRunner: runner });
    spec.renderer.language = 'python';
    const first = service.submit({ projectId: spec.id, spec, data });
    await waitFor(() => service.getJob(first.id)?.status === 'succeeded');
    expect(service.getJob(first.id)?.artifacts.some((artifact) => artifact.kind === 'preview')).toBe(true);

    fail = true;
    spec.chart.title = 'changed';
    const second = service.submit({ projectId: spec.id, spec, data, force: true });
    await waitFor(() => service.getJob(second.id)?.status === 'failed');
    expect(service.getJob(second.id)?.artifacts.every((artifact) => artifact.stale)).toBe(true);
    expect(service.getJob(second.id)?.message).toMatch(/退出码 2/);
  });

  it('writes UTF-8 BOM data so R and MATLAB preserve Chinese labels', async () => {
    const { store, spec, runtime } = await setup();
    const chineseData: PlotDataTable = {
      ...data,
      columns: [{ id: '算法', label: '算法', type: 'category' }, { id: '成功率', label: '成功率', type: 'number' }],
      rows: [['安全强化学习', 0.91]],
      source: { kind: 'generated', name: '中文数据' }
    };
    spec.encodings = { x: '算法', y: '成功率', color: '算法' };
    const runner: RuntimeCommandRunner = async (_executable, _args, options) => {
      const csv = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(options?.cwd as string, 'data.csv')));
      expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(csv.toString('utf8')).toContain('安全强化学习');
      const output = path.join(options?.cwd as string, 'output');
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'preview.svg'), '<svg></svg>');
      await writeFile(path.join(output, 'analysis-results.json'), '[]');
      await writeFile(path.join(output, 'render-manifest.json'), JSON.stringify({ language: 'python', chartType: 'line', preview: 'preview.svg' }));
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const service = new PlotRendererService({ store, runtimeManager: runtime, commandRunner: runner });
    spec.renderer.language = 'python';
    const job = service.submit({ projectId: spec.id, spec, data: chineseData });
    await waitFor(() => service.getJob(job.id)?.status === 'succeeded');
  });

  it('fails with a repairable status when the selected runtime is missing', async () => {
    const { store, spec } = await setup();
    spec.renderer.language = 'r';
    const service = new PlotRendererService({
      store,
      runtimeManager: { detectAll: async () => [], getRuntimeCommand: () => undefined }
    });
    const job = service.submit({ projectId: spec.id, spec, data });
    await waitFor(() => service.getJob(job.id)?.status === 'failed');
    expect(service.getJob(job.id)?.errorCode).toBe('runtime-missing');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for render job.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
