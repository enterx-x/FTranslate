import { describe, expect, it } from 'vitest';
import { buildRuntimeCenterSnapshot } from './runtimeCenter';
import type { LocalTranslationStatus } from './localTranslationService';

function makeLocalTranslationStatus(
  patch: Partial<LocalTranslationStatus['nllb']> = {},
  worker: Partial<LocalTranslationStatus['worker']> = {}
): LocalTranslationStatus {
  return {
    preferredEngine: 'nllb-first',
    nllb: {
      configured: true,
      available: true,
      pythonPath: 'E:\\FTranslateTools\\nllb-ctranslate2\\Scripts\\python.exe',
      modelDir: 'E:\\FTranslateTools\\models\\nllb-200-distilled-600M-ct2-int8',
      tokenizerDir: 'E:\\FTranslateTools\\hf-cache\\nllb-200-distilled-600M-snapshot',
      device: 'auto',
      runtimeDevice: 'cuda',
      runtimeState: 'ready',
      cudaDllDirs: ['E:\\FTranslateTools\\cuda-runtime\\nvidia\\cublas\\bin'],
      lastRuntimeError: '',
      lastFallbackReason: '',
      lastCheckedAt: '2026-07-01T00:00:00.000Z',
      warmupMs: 1234,
      message: 'NLLB worker ready',
      ...patch
    },
    fallback: { engine: 'argos', message: 'Argos fallback retained' },
    worker: { running: true, pending: 0, ...worker }
  };
}

describe('buildRuntimeCenterSnapshot', () => {
  it('builds a safe local runtime snapshot', () => {
    const snapshot = buildRuntimeCenterSnapshot({
      now: '2026-07-01T00:00:00.000Z',
      localTranslationStatus: makeLocalTranslationStatus(),
      pdfTranslationEngine: {
        status: 'available',
        command: 'pdf2zh',
        message: 'pdf2zh available',
        installCommand: 'pip install pdf2zh'
      },
      aiProvider: {
        provider: 'kimi',
        baseURL: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.5',
        hasApiKey: true
      },
      queue: [
        { id: 'nllb-worker', kind: 'local-translation', status: 'idle', label: 'NLLB worker' }
      ]
    });

    expect(snapshot.generatedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(snapshot.overallStatus).toBe('ready');
    expect(snapshot.capabilities.map((item) => item.id)).toEqual([
      'nllb',
      'argos',
      'pdf2zh',
      'ai-provider'
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('sk-');
    expect(snapshot.queue.pendingCount).toBe(0);
  });

  it('marks runtime degraded when NLLB falls back to CPU', () => {
    const snapshot = buildRuntimeCenterSnapshot({
      now: '2026-07-01T00:00:00.000Z',
      localTranslationStatus: makeLocalTranslationStatus(
        {
          runtimeDevice: 'cpu',
          runtimeState: 'cpu_fallback',
          lastFallbackReason: 'CUDA DLL missing',
          message: 'CPU fallback'
        },
        { pending: 2 }
      ),
      pdfTranslationEngine: {
        status: 'available',
        command: 'pdf2zh',
        message: 'ok',
        installCommand: ''
      },
      aiProvider: {
        provider: 'openai',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        hasApiKey: true
      },
      queue: []
    });

    expect(snapshot.overallStatus).toBe('degraded');
    expect(snapshot.capabilities.find((item) => item.id === 'nllb')?.status).toBe('degraded');
    expect(snapshot.queue.pendingCount).toBe(2);
    expect(snapshot.actions.some((action) => action.includes('CUDA'))).toBe(true);
  });

  it('marks AI provider unavailable without exposing the key', () => {
    const snapshot = buildRuntimeCenterSnapshot({
      now: '2026-07-01T00:00:00.000Z',
      localTranslationStatus: makeLocalTranslationStatus(),
      pdfTranslationEngine: {
        status: 'available',
        command: 'pdf2zh',
        message: 'ok',
        installCommand: ''
      },
      aiProvider: {
        provider: 'openai',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        hasApiKey: false
      },
      queue: []
    });

    expect(snapshot.overallStatus).toBe('unavailable');
    expect(snapshot.capabilities.find((item) => item.id === 'ai-provider')?.status).toBe('unavailable');
    expect(snapshot.actions).toContain('Configure an AI API key before using cloud-backed analysis.');
  });
});
