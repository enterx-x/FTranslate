import { describe, expect, it } from 'vitest';
import { decodeBase64ToUint8Array } from './binary';

describe('decodeBase64ToUint8Array', () => {
  it('decodes binary bytes without allocating through Array.from callbacks', () => {
    expect([...decodeBase64ToUint8Array('AAEC/f7/')]).toEqual([0, 1, 2, 253, 254, 255]);
  });
});
