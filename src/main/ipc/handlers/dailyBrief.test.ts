import { describe, expect, it, vi } from 'vitest';
import { registerDailyBriefIpcHandlers } from './dailyBrief';

describe('daily brief IPC', () => {
  it('delegates changes to one service and propagates persistence failures', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const snapshot = { running: false };
    const service = {
      getSnapshot: vi.fn(async () => snapshot),
      savePreferences: vi.fn(async () => { throw new Error('disk full'); }),
      run: vi.fn(async () => snapshot),
      setFeedback: vi.fn(async () => snapshot),
      removeFeedback: vi.fn(async () => snapshot)
    };
    registerDailyBriefIpcHandlers({ handle: (name, handler) => { handlers.set(name, handler); } }, service as any);
    expect(await handlers.get('daily-brief:snapshot')!({})).toBe(snapshot);
    await expect(handlers.get('daily-brief:save-preferences')!({}, { interests: 'robotics' })).rejects.toThrow('disk full');
    await handlers.get('daily-brief:feedback')!({}, { paperId: '2609.00001', kind: 'dismissed' });
    expect(service.setFeedback).toHaveBeenCalledWith({ paperId: '2609.00001', kind: 'dismissed' });
    await handlers.get('daily-brief:remove-feedback')!({}, '2609.00001');
    expect(service.removeFeedback).toHaveBeenCalledWith('2609.00001');
    expect(await handlers.get('daily-brief:run')!({})).toBe(snapshot);
  });
});
