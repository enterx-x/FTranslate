import { describe, expect, it } from 'vitest';
import { selectRuntimeActionLabel, summarizeRuntimeCenter } from './runtimeCenter';

describe('runtimeCenter renderer helpers', () => {
  it('summarizes capability counts and next action', () => {
    const summary = summarizeRuntimeCenter({
      generatedAt: '2026-07-01T00:00:00.000Z',
      overallStatus: 'degraded',
      capabilities: [
        { id: 'comet-mbr', label: 'COMET-MBR', status: 'ready', message: 'CPU ready', details: {} },
        { id: 'nllb', label: 'NLLB', status: 'degraded', message: 'CPU fallback', details: {} },
        { id: 'argos', label: 'Argos', status: 'ready', message: 'fallback', details: {} },
        { id: 'pdf2zh', label: 'pdf2zh', status: 'ready', message: 'ok', details: {} },
        { id: 'ai-provider', label: 'AI provider', status: 'unavailable', message: 'missing key', details: {} }
      ],
      queue: { items: [], pendingCount: 0, runningCount: 0, failedCount: 0 },
      actions: ['Configure an AI API key before using cloud-backed analysis.', 'Check CUDA DLL paths.']
    });

    expect(summary.readyCount).toBe(3);
    expect(summary.degradedCount).toBe(1);
    expect(summary.unavailableCount).toBe(1);
    expect(selectRuntimeActionLabel(summary)).toBe('Configure an AI API key before using cloud-backed analysis.');
  });

  it('returns a stable fallback action label', () => {
    expect(
      selectRuntimeActionLabel({
        readyCount: 0,
        degradedCount: 0,
        unavailableCount: 0,
        unknownCount: 0,
        nextActions: []
      })
    ).toBe('Refresh runtime status');
  });
});
