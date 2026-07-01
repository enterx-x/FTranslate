import { describe, expect, it } from 'vitest';
import { registerRuntimeIpcHandlers } from './runtime';

describe('registerRuntimeIpcHandlers', () => {
  it('registers runtime snapshot and check channels', () => {
    const channels: string[] = [];

    registerRuntimeIpcHandlers(
      { handle: (channel: string) => channels.push(channel) },
      {
        getRuntimeCenterSnapshot: () => ({ ok: true }),
        checkRuntimeCenter: () => ({ ok: true })
      }
    );

    expect(channels).toEqual(['runtime-center:snapshot', 'runtime-center:check']);
  });
});
