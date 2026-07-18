import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CometMbrRuntime, resolveCometMbrWorkerPath } from './cometMbrRuntime';

const fakeWorkerSource = String.raw`
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const request = JSON.parse(line);
  const source = request.pairs?.[0]?.source;
  if (source === '__malformed__') {
    process.stdout.write('not-json\n');
    continue;
  }
  if (source === '__timeout__') {
    continue;
  }
  if (source === '__exit__') {
    process.exit(2);
  }
  if (request.action === 'probe') {
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: {
      modelId: 'Unbabel/wmt22-comet-da',
      modelRevision: '2760a223ac957f30acfb18c8aa649b01cf1d75f2',
      device: 'cpu'
    } }) + '\n');
    continue;
  }
  if (request.action === 'score') {
    const scores = source === '__wrong_count__' ? [] : request.pairs.map(() => 0.75);
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { scores, device: 'cpu' } }) + '\n');
    continue;
  }
  if (request.action === 'unload' || request.action === 'shutdown') {
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { unloaded: true } }) + '\n');
    if (request.action === 'shutdown') process.exit(0);
  }
}
`;

describe('CometMbrRuntime JSONL worker', () => {
  let tempDir: string;
  let workerPath: string;
  let modelPath: string;
  const runtimes: CometMbrRuntime[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-comet-runtime-'));
    workerPath = path.join(tempDir, 'fake-worker.mjs');
    modelPath = path.join(tempDir, 'model.ckpt');
    await fs.writeFile(workerPath, fakeWorkerSource, 'utf8');
    await fs.writeFile(modelPath, 'fake checkpoint', 'utf8');
  });

  afterEach(async () => {
    runtimes.forEach((runtime) => runtime.close());
    runtimes.length = 0;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createRuntime(timeoutMs = 2_000): CometMbrRuntime {
    const runtime = new CometMbrRuntime({
      pythonPath: process.execPath,
      workerPath,
      modelPath,
      timeoutMs
    });
    runtimes.push(runtime);
    return runtime;
  }

  it('correlates score responses and reports the pinned model identity', async () => {
    const runtime = createRuntime();
    const probe = await runtime.probe();
    const scores = await runtime.score([
      { source: 'source', translation: '译文甲', reference: '译文乙' }
    ]);

    expect(probe).toMatchObject({
      available: true,
      modelId: 'Unbabel/wmt22-comet-da',
      modelRevision: '2760a223ac957f30acfb18c8aa649b01cf1d75f2',
      device: 'cpu',
      state: 'ready'
    });
    expect(scores).toEqual([0.75]);
    expect(runtime.snapshot().pending).toBe(0);
  });

  it('resolves the unpacked packaged worker before the development asset path', async () => {
    const packagedWorker = path.join(tempDir, 'runtime', 'comet-mbr', 'comet_mbr_worker.py');
    await fs.mkdir(path.dirname(packagedWorker), { recursive: true });
    await fs.writeFile(packagedWorker, '# packaged worker', 'utf8');

    expect(resolveCometMbrWorkerPath({ resourcesPath: tempDir, moduleDir: path.join(tempDir, 'dist') }))
      .toBe(packagedWorker);
  });

  it('rejects malformed worker output and marks the runtime failed', async () => {
    const runtime = createRuntime();
    await expect(runtime.score([
      { source: '__malformed__', translation: '甲', reference: '乙' }
    ])).rejects.toThrow(/JSON|协议/u);
    expect(runtime.snapshot()).toMatchObject({ state: 'failed', available: false });
  });

  it('rejects a wrong score count instead of silently pairing the wrong rows', async () => {
    const runtime = createRuntime();
    await expect(runtime.score([
      { source: '__wrong_count__', translation: '甲', reference: '乙' }
    ])).rejects.toThrow(/数量/u);
  });

  it('times out stalled work and clears pending requests', async () => {
    const runtime = createRuntime(80);
    await expect(runtime.score([
      { source: '__timeout__', translation: '甲', reference: '乙' }
    ])).rejects.toThrow(/超时/u);
    expect(runtime.snapshot().pending).toBe(0);
    expect(runtime.snapshot().state).toBe('failed');
  });

  it('rejects pending work when the worker exits unexpectedly', async () => {
    const runtime = createRuntime();
    await expect(runtime.score([
      { source: '__exit__', translation: '甲', reference: '乙' }
    ])).rejects.toThrow(/退出/u);
    expect(runtime.snapshot().state).toBe('failed');
  });

  it('unloads and closes without leaving a ready worker state', async () => {
    const runtime = createRuntime();
    await runtime.probe();
    await runtime.unload();
    expect(runtime.snapshot()).toMatchObject({ state: 'not_checked', available: false, pending: 0 });

    runtime.close();
    expect(runtime.snapshot()).toMatchObject({ state: 'not_checked', available: false, pending: 0 });
  });
});
