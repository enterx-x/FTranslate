import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCodeRepository } from './codeRepositoryScanner';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ftranslate-code-repo-'));
  await fs.writeFile(path.join(root, 'README.md'), '# Safe RL\n\nRun `python train.py --config configs/nav.yaml`.', 'utf8');
  await fs.writeFile(path.join(root, 'requirements.txt'), 'torch==2.2.0\ngymnasium==0.29.1\n', 'utf8');
  await fs.writeFile(path.join(root, 'train.py'), 'import argparse\nprint("train")\n', 'utf8');
  await fs.writeFile(path.join(root, 'train_ppo.py'), 'import argparse\nprint("train ppo")\n', 'utf8');
  await fs.mkdir(path.join(root, 'configs'));
  await fs.writeFile(path.join(root, 'configs', 'nav.yaml'), 'env: Navigation-v0\n', 'utf8');
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'ignored', 'utf8');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('scanCodeRepository', () => {
  it('detects manifests, entry candidates and ignores generated folders', async () => {
    const result = await scanCodeRepository({ rootPath: root, now: '2026-07-01T00:00:00.000Z' });

    expect(result.rootPath).toBe(root);
    expect(result.manifests.map((item) => item.fileName)).toEqual(['requirements.txt']);
    expect(result.entryPoints.map((item) => item.filePath.replace(/\\/g, '/'))).toContain('train.py');
    expect(result.entryPoints.map((item) => item.filePath.replace(/\\/g, '/'))).toContain('train_ppo.py');
    expect(result.configFiles.map((item) => item.filePath.replace(/\\/g, '/'))).toContain('configs/nav.yaml');
    expect(result.files.some((item) => item.filePath.includes('node_modules'))).toBe(false);
  });

  it('refuses to scan when the root is missing', async () => {
    await expect(
      scanCodeRepository({ rootPath: path.join(root, 'missing'), now: '2026-07-01T00:00:00.000Z' })
    ).rejects.toThrow(/not a directory/i);
  });
});
