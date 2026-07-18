import { describe, expect, it } from 'vitest';
import { buildRuntimeCenterSnapshot } from './runtimeCenter';
import type { LocalTranslationStatus } from './localTranslationService';
import type { CometMbrRuntimeSnapshot } from './cometMbrRuntime';

function makeCometMbrSnapshot(
  patch: Partial<CometMbrRuntimeSnapshot> = {}
): CometMbrRuntimeSnapshot {
  return {
    configured: true,
    available: true,
    pythonPath: 'E:\\FTranslateTools\\comet-mbr\\.venv\\Scripts\\python.exe',
    workerPath: 'D:\\FTranslate\\assets\\runtime\\comet-mbr\\comet_mbr_worker.py',
    modelPath: 'E:\\FTranslateTools\\comet-mbr\\models\\wmt22-comet-da\\checkpoints\\model.ckpt',
    modelId: 'Unbabel/wmt22-comet-da',
    modelRevision: '2760a223ac957f30acfb18c8aa649b01cf1d75f2',
    device: 'cpu',
    state: 'ready',
    lastError: '',
    pending: 0,
    ...patch
  };
}

function makeLocalTranslationStatus(
  patch: Partial<LocalTranslationStatus['nllb']> = {},
  worker: Partial<LocalTranslationStatus['worker']> = {}
): LocalTranslationStatus {
  return {
    preferredEngine: 'hy-mt-first',
    hymt: {
      configured: true,
      available: true,
      serverPath: 'E:\\FTranslateTools\\hy-mt2\\runtime\\llama-server.exe',
      modelPath: 'E:\\FTranslateTools\\hy-mt2\\models\\Hy-MT2-1.8B-Q4_K_M.gguf',
      runtimeDevice: 'cuda',
      runtimeState: 'ready',
      lastRuntimeError: '',
      lastCheckedAt: '2026-07-01T00:00:00.000Z',
      warmupMs: 900,
      message: 'HY-MT2 ready'
    },
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
      cometMbr: makeCometMbrSnapshot(),
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
      'hy-mt2',
      'comet-mbr',
      'nllb',
      'argos',
      'pdf2zh',
      'ai-provider'
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('sk-');
    expect(snapshot.queue.pendingCount).toBe(0);
    expect(snapshot.capabilities.find((item) => item.id === 'comet-mbr')).toMatchObject({
      label: 'COMET-MBR',
      status: 'ready',
      details: { runtimeDevice: 'cpu' }
    });
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
      cometMbr: makeCometMbrSnapshot(),
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
      cometMbr: makeCometMbrSnapshot(),
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

  it('marks a missing HY-MT2 runtime as degraded when NLLB remains available', () => {
    const localTranslationStatus = makeLocalTranslationStatus();
    localTranslationStatus.hymt = {
      ...localTranslationStatus.hymt,
      configured: false,
      available: false,
      runtimeState: 'not_checked'
    };

    const snapshot = buildRuntimeCenterSnapshot({
      now: '2026-07-01T00:00:00.000Z',
      localTranslationStatus,
      cometMbr: makeCometMbrSnapshot(),
      pdfTranslationEngine: {
        status: 'available',
        message: 'Ready',
        command: 'pdf2zh',
        installCommand: ''
      },
      aiProvider: {
        provider: 'deepseek',
        baseURL: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        hasApiKey: true
      },
      queue: []
    });

    expect(snapshot.overallStatus).toBe('degraded');
    expect(snapshot.capabilities.find((item) => item.id === 'hy-mt2')?.status).toBe('degraded');
    expect(snapshot.actions).toContain('Install HY-MT2 for the highest-quality local academic translation.');
  });
});
