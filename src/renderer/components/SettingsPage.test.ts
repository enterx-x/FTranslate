import { describe, expect, it } from 'vitest';
import type { LocalTranslationStatus } from '../types/electron';
import { DEFAULT_SETTINGS_CATEGORY, describeLocalTranslationBadge } from './SettingsPage';

function makeLocalTranslationStatus(): LocalTranslationStatus {
  return {
    preferredEngine: 'hy-mt-first',
    hymt: {
      configured: true,
      available: false,
      serverPath: 'llama-server.exe',
      modelPath: 'Hy-MT2-7B-Q4_K_M.gguf',
      runtimeDevice: 'unknown',
      runtimeState: 'not_checked',
      lastRuntimeError: '',
      lastCheckedAt: '',
      warmupMs: 0,
      message: '等待预热'
    },
    nllb: {
      configured: true,
      available: false,
      pythonPath: 'python',
      modelDir: 'model',
      tokenizerDir: 'tokenizer',
      device: 'auto',
      runtimeDevice: 'unknown',
      runtimeState: 'not_checked',
      cudaDllDirs: [],
      lastRuntimeError: '',
      lastFallbackReason: '',
      lastCheckedAt: '',
      warmupMs: 0,
      message: '等待检查'
    },
    fallback: { engine: 'argos', message: 'fallback' },
    worker: { running: false, pending: 0 }
  };
}

describe('SettingsPage defaults', () => {
  it('opens the general category first', () => {
    expect(DEFAULT_SETTINGS_CATEGORY).toBe('general');
  });

  it('does not label a configured HY-MT2 runtime as Argos fallback before warmup', () => {
    expect(describeLocalTranslationBadge(makeLocalTranslationStatus())).toBe('HY-MT2 7B 质量档 · 待预热');
  });
});
