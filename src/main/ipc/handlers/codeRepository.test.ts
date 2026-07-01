import { describe, expect, it } from 'vitest';
import { registerCodeRepositoryIpcHandlers } from './codeRepository';

describe('registerCodeRepositoryIpcHandlers', () => {
  it('registers repository selection and scan channels', () => {
    const channels: string[] = [];

    registerCodeRepositoryIpcHandlers(
      { handle: (channel: string) => channels.push(channel) },
      {
        selectCodeRepository: () => null,
        scanCodeRepository: () => null
      }
    );

    expect(channels).toEqual(['code-repository:select', 'code-repository:scan']);
  });
});
