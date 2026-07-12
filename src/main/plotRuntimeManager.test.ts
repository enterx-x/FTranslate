import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlotRuntimeManager, type RuntimeCommandRunner } from './plotRuntimeManager';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ftranslate-runtime-'));
  roots.push(root);
  return root;
}

describe('plot runtime manager', () => {
  it('detects Python but never mistakes PowerShell r for Rscript', async () => {
    const root = await fixtureRoot();
    const calls: string[] = [];
    const runner: RuntimeCommandRunner = async (executable, args) => {
      calls.push(`${executable} ${args.join(' ')}`);
      if (executable === 'where.exe' && args[0] === 'python.exe') return { exitCode: 0, stdout: 'C:\\Python312\\python.exe\n', stderr: '' };
      if (executable === 'where.exe') return { exitCode: 1, stdout: '', stderr: '' };
      if (executable.endsWith('python.exe') && args.includes('--version')) return { exitCode: 0, stdout: 'Python 3.12.10', stderr: '' };
      if (executable.endsWith('python.exe') && args.includes('-c')) return { exitCode: 0, stdout: '{"matplotlib":"3.10.3","seaborn":"0.13.2","plotly":"6.2.0","scipy":"1.16.0","statsmodels":"0.14.5","pandas":"2.3.1"}', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    const manager = new PlotRuntimeManager({ managedRoot: root, manifestPath: path.join(root, 'manifest.json'), commandRunner: runner, env: {} });
    const runtimes = await manager.detectAll();

    expect(runtimes.find((runtime) => runtime.language === 'python')?.status).toBe('ready');
    expect(runtimes.find((runtime) => runtime.language === 'r')?.status).toBe('missing');
    expect(calls.some((call) => /^r(?:\.exe)?\s/i.test(call))).toBe(false);
  });

  it('reads installer intent without treating it as an installed runtime', async () => {
    const root = await fixtureRoot();
    const intent = path.join(root, 'plot-runtime-intent.ini');
    await writeFile(intent, '[PlotRuntimes]\nPython=1\nR=0\nMatlabDetect=1\n');
    const manager = new PlotRuntimeManager({ managedRoot: root, manifestPath: path.join(root, 'manifest.json'), installerIntentPath: intent });
    expect(await manager.readInstallerIntent()).toEqual({ python: true, r: false, matlabDetect: true });
  });

  it('fails closed when an official installer hash does not match', async () => {
    const root = await fixtureRoot();
    const manifestPath = path.join(root, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: '1.0', runtimes: {
      python: { version: '3.12.10', fileName: 'python.exe', url: 'https://example.invalid/python.exe', sha256: createHash('sha256').update('expected').digest('hex'), size: 3, license: 'Python-2.0' },
      r: { version: '4.5.1', fileName: 'r.exe', url: 'https://example.invalid/r.exe', sha256: '0'.repeat(64), size: 3, license: 'GPL' }
    } }));
    const manager = new PlotRuntimeManager({
      managedRoot: root,
      manifestPath,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]))
    });
    const job = manager.startInstall('python');
    await waitFor(() => manager.getInstallJob(job.id)?.status === 'failed');
    expect(manager.getInstallJob(job.id)?.error).toMatch(/SHA256/);
  });

  it('refuses to remove a directory without the managed-runtime marker', async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, 'python'), { recursive: true });
    const manager = new PlotRuntimeManager({ managedRoot: root, manifestPath: path.join(root, 'manifest.json') });
    await expect(manager.removeManagedRuntime('python')).rejects.toThrow(/拒绝删除/);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for runtime job.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
