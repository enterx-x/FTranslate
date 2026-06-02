import { describe, expect, it } from 'vitest';
import { arrayBufferToBase64 } from './binaryEncoding';

describe('binaryEncoding', () => {
  it('encodes an ArrayBuffer into base64 without data loss', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);

    expect(arrayBufferToBase64(bytes.buffer)).toBe('AAECf4D/');
  });

  it('encodes large buffers by chunks to avoid call stack overflow', () => {
    const bytes = new Uint8Array(100_000);
    bytes[0] = 65;
    bytes[99_999] = 90;

    const encoded = arrayBufferToBase64(bytes.buffer);

    expect(encoded.startsWith('QQ')).toBe(true);
    expect(encoded.length).toBeGreaterThan(100_000);
  });
});
