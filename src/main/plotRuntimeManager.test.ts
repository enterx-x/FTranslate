import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRPackageInstallExpression, PlotRuntimeManager, type RuntimeCommandRunner } from './plotRuntimeManager';

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
    expect(await manager.acknowledgeInstallerIntent()).toBe(true);
    expect(await manager.readInstallerIntent()).toEqual({ python: false, r: false, matlabDetect: false });
  });

  it('detects a managed runtime from a user-selected parent directory after restart', async () => {
    const root = await fixtureRoot();
    const customRoot = path.join(root, 'custom-runtimes');
    const python = path.join(customRoot, 'python', 'python.exe');
    await writeFile(path.join(root, 'runtime-roots.json'), JSON.stringify({ python: customRoot }));
    const runner: RuntimeCommandRunner = async (executable, args) => {
      if (executable === python && args.includes('--version')) return { exitCode: 0, stdout: 'Python 3.12.10', stderr: '' };
      if (executable === python && args.includes('-c')) return { exitCode: 0, stdout: '{"matplotlib":"3.10.3","seaborn":"0.13.2","plotly":"6.2.0","scipy":"1.16.0","statsmodels":"0.14.5","pandas":"2.3.1"}', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    const manager = new PlotRuntimeManager({ managedRoot: root, manifestPath: path.join(root, 'manifest.json'), commandRunner: runner, env: {} });
    const capability = (await manager.detectAll()).find((runtime) => runtime.language === 'python');
    expect(capability).toMatchObject({ status: 'ready', executable: python, managed: true });
  });

  it('prefers a complete system Python over an earlier degraded candidate', async () => {
    const root = await fixtureRoot();
    const degraded = 'C:\\Python310\\python.exe';
    const ready = 'D:\\Python312\\python.exe';
    const runner: RuntimeCommandRunner = async (executable, args) => {
      if (executable === 'where.exe' && args[0] === 'python.exe') return { exitCode: 0, stdout: `${degraded}\n${ready}\n`, stderr: '' };
      if (executable === 'where.exe' || executable === 'reg.exe') return { exitCode: 1, stdout: '', stderr: '' };
      if ((executable === degraded || executable === ready) && args.includes('--version')) return { exitCode: 0, stdout: executable === degraded ? 'Python 3.10.14' : 'Python 3.12.10', stderr: '' };
      if (executable === degraded && args.includes('-c')) return { exitCode: 0, stdout: '{"pandas":"2.2.3"}', stderr: '' };
      if (executable === ready && args.includes('-c')) return { exitCode: 0, stdout: '{"matplotlib":"3.10.3","seaborn":"0.13.2","plotly":"6.2.0","scipy":"1.16.0","statsmodels":"0.14.5","pandas":"2.3.1"}', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    const manager = new PlotRuntimeManager({ managedRoot: root, manifestPath: path.join(root, 'manifest.json'), commandRunner: runner, env: {} });
    const capability = (await manager.detectAll()).find((runtime) => runtime.language === 'python');
    expect(capability).toMatchObject({ status: 'ready', executable: ready, managed: false });
    expect(manager.getRuntimeCommand('python')?.executable).toBe(ready);
  });

  it('repairs an existing R environment with valid R vector syntax', async () => {
    const root = await fixtureRoot();
    const rscript = 'D:\\R\\R-4.5.1\\bin\\Rscript.exe';
    const installExpressions: string[] = [];
    const runner: RuntimeCommandRunner = async (executable, args) => {
      if (executable === 'where.exe' && args[0] === 'Rscript.exe') return { exitCode: 0, stdout: `${rscript}\n`, stderr: '' };
      if (executable === 'where.exe' || executable === 'reg.exe') return { exitCode: 1, stdout: '', stderr: '' };
      if (executable === rscript && args.includes('--version')) return { exitCode: 0, stdout: 'R scripting front-end version 4.5.1', stderr: '' };
      if (executable === rscript && args.includes('-e')) {
        const expression = args.at(-1) ?? '';
        if (expression.includes('FTRANSLATE_PACKAGE=')) return { exitCode: 0, stdout: 'FTRANSLATE_PACKAGE=jsonlite\t2.0.0\n', stderr: '' };
        installExpressions.push(expression);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    const manager = new PlotRuntimeManager({ managedRoot: root, manifestPath: path.join(root, 'manifest.json'), commandRunner: runner, env: {} });
    expect((await manager.detectAll()).find((runtime) => runtime.language === 'r')?.status).toBe('degraded');
    const job = manager.startRepair('r');
    await waitFor(() => manager.getInstallJob(job.id)?.status === 'succeeded');
    expect(installExpressions[0]).toContain('jsonlite');
    expect(installExpressions.at(-1)).toContain('BiocManager::install("ComplexHeatmap"');
    expect(installExpressions.join('\n')).not.toContain('dependencies=TRUE');
  });

  it('reuses the active repair job instead of starting duplicate package installers', async () => {
    const root = await fixtureRoot();
    const rscript = 'D:\\R\\R-4.5.1\\bin\\Rscript.exe';
    let releaseInstall: (() => void) | undefined;
    const installGate = new Promise<void>((resolve) => { releaseInstall = resolve; });
    const runner: RuntimeCommandRunner = async (executable, args) => {
      if (executable === 'where.exe' && args[0] === 'Rscript.exe') return { exitCode: 0, stdout: `${rscript}\n`, stderr: '' };
      if (executable === 'where.exe' || executable === 'reg.exe') return { exitCode: 1, stdout: '', stderr: '' };
      if (executable === rscript && args.includes('--version')) return { exitCode: 0, stdout: 'R scripting front-end version 4.5.1', stderr: '' };
      if (executable === rscript && args.includes('-e')) {
        const expression = args.at(-1) ?? '';
        if (expression.includes('FTRANSLATE_PACKAGE=')) return { exitCode: 0, stdout: '', stderr: '' };
        await installGate;
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    const manager = new PlotRuntimeManager({ managedRoot: root, manifestPath: path.join(root, 'manifest.json'), commandRunner: runner, env: {} });
    await manager.detectAll();
    const first = manager.startRepair('r');
    const second = manager.startRepair('r');
    expect(second.id).toBe(first.id);
    releaseInstall?.();
    await waitFor(() => manager.getInstallJob(first.id)?.status === 'succeeded');
  });

  it('builds R package installation code without JavaScript array syntax', () => {
    const expression = buildRPackageInstallExpression();
    expect(expression).toContain('c("jsonlite","ggplot2"');
    expect(expression).not.toContain('["jsonlite"');
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
