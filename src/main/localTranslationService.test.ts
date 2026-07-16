import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getLocalTranslationStatus,
  resolveLocalTranslationPreference,
  resolveNllbBeamSize,
  resolveNllbCudaDllDirs,
  resolveNllbMaxDecodingLength
} from './localTranslationService';

const originalCudaDllDirs = process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS;
const originalModelDir = process.env.FTRANSLATE_NLLB_MODEL_DIR;
const originalTokenizerDir = process.env.FTRANSLATE_NLLB_TOKENIZER_DIR;
const originalDevice = process.env.FTRANSLATE_NLLB_DEVICE;
const originalBeamSize = process.env.FTRANSLATE_NLLB_BEAM_SIZE;
const originalMaxDecodingLength = process.env.FTRANSLATE_NLLB_MAX_DECODING_LENGTH;
const originalLocalTranslationEngine = process.env.FTRANSLATE_LOCAL_TRANSLATION_ENGINE;

afterEach(() => {
  if (originalCudaDllDirs === undefined) {
    delete process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS;
  } else {
    process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS = originalCudaDllDirs;
  }
  if (originalModelDir === undefined) {
    delete process.env.FTRANSLATE_NLLB_MODEL_DIR;
  } else {
    process.env.FTRANSLATE_NLLB_MODEL_DIR = originalModelDir;
  }
  if (originalTokenizerDir === undefined) {
    delete process.env.FTRANSLATE_NLLB_TOKENIZER_DIR;
  } else {
    process.env.FTRANSLATE_NLLB_TOKENIZER_DIR = originalTokenizerDir;
  }
  if (originalDevice === undefined) {
    delete process.env.FTRANSLATE_NLLB_DEVICE;
  } else {
    process.env.FTRANSLATE_NLLB_DEVICE = originalDevice;
  }
  if (originalBeamSize === undefined) {
    delete process.env.FTRANSLATE_NLLB_BEAM_SIZE;
  } else {
    process.env.FTRANSLATE_NLLB_BEAM_SIZE = originalBeamSize;
  }
  if (originalMaxDecodingLength === undefined) {
    delete process.env.FTRANSLATE_NLLB_MAX_DECODING_LENGTH;
  } else {
    process.env.FTRANSLATE_NLLB_MAX_DECODING_LENGTH = originalMaxDecodingLength;
  }
  if (originalLocalTranslationEngine === undefined) {
    delete process.env.FTRANSLATE_LOCAL_TRANSLATION_ENGINE;
  } else {
    process.env.FTRANSLATE_LOCAL_TRANSLATION_ENGINE = originalLocalTranslationEngine;
  }
});

describe('localTranslationService engine preference', () => {
  it('defaults to the dedicated HY-MT2 engine and preserves explicit legacy overrides', () => {
    delete process.env.FTRANSLATE_LOCAL_TRANSLATION_ENGINE;
    expect(resolveLocalTranslationPreference()).toBe('hy-mt-first');

    process.env.FTRANSLATE_LOCAL_TRANSLATION_ENGINE = 'nllb-only';
    expect(resolveLocalTranslationPreference()).toBe('nllb-only');
  });
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

  it('reports configured NLLB as not checked until a real runtime smoke succeeds', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftranslate-nllb-status-'));
    const modelDir = path.join(root, 'model');
    const tokenizerDir = path.join(root, 'tokenizer');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.mkdirSync(tokenizerDir, { recursive: true });
    process.env.FTRANSLATE_NLLB_MODEL_DIR = modelDir;
    process.env.FTRANSLATE_NLLB_TOKENIZER_DIR = tokenizerDir;
    process.env.FTRANSLATE_NLLB_DEVICE = 'auto';
    delete process.env.FTRANSLATE_NLLB_CUDA_DLL_DIRS;

    const status = getLocalTranslationStatus();

    expect(status.nllb.configured).toBe(true);
    expect(status.nllb.available).toBe(false);
    expect(status.nllb.runtimeState).toBe('not_checked');
    expect(status.nllb.runtimeDevice).toBe('unknown');
    expect(status.nllb.cudaDllDirs).toEqual(expect.any(Array));
    expect(status.nllb.lastCheckedAt).toBe('');
    expect(status.nllb.message).toContain('尚未完成');
  });
});

describe('localTranslationService NLLB decoding settings', () => {
  it('defaults to faster greedy decoding with bounded output length', () => {
    delete process.env.FTRANSLATE_NLLB_BEAM_SIZE;
    delete process.env.FTRANSLATE_NLLB_MAX_DECODING_LENGTH;

    expect(resolveNllbBeamSize()).toBe(1);
    expect(resolveNllbMaxDecodingLength()).toBe(512);
  });

  it('allows bounded environment overrides for quality-focused local runs', () => {
    process.env.FTRANSLATE_NLLB_BEAM_SIZE = '16';
    process.env.FTRANSLATE_NLLB_MAX_DECODING_LENGTH = '9999';

    expect(resolveNllbBeamSize()).toBe(8);
    expect(resolveNllbMaxDecodingLength()).toBe(1024);
  });
});
