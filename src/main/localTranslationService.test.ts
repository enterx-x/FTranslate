import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveNllbCudaDllDirs } from './localTranslationService';

const originalCudaDllDirs = process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS;

afterEach(() => {
  if (originalCudaDllDirs === undefined) {
    delete process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS;
  } else {
    process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS = originalCudaDllDirs;
  }
});

describe('localTranslationService CUDA runtime discovery', () => {
  it('accepts CUDA runtime DLLs split across private dependency directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftranslate-cuda-dlls-'));
    const cublasDir = path.join(root, 'nvidia', 'cublas', 'bin');
    const runtimeDir = path.join(root, 'nvidia', 'cuda_runtime', 'bin');
    fs.mkdirSync(cublasDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(cublasDir, 'cublas64_12.dll'), '');
    fs.writeFileSync(path.join(runtimeDir, 'cudart64_12.dll'), '');

    process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS = `${cublasDir};${runtimeDir}`;

    expect(resolveNllbCudaDllDirs()).toEqual(expect.arrayContaining([cublasDir, runtimeDir]));
  });
});
