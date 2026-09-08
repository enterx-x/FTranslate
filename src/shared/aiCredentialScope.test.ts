import { describe, expect, it } from 'vitest';
import { canReuseAiCredential } from './aiCredentialScope';

describe('AI credential destination', () => {
  const previous = { provider: 'custom', baseURL: 'https://api.example.com/v1' };
  it('retains the key for paths on the same provider and origin', () => {
    expect(canReuseAiCredential(previous, { ...previous, baseURL: 'https://api.example.com/v2/' })).toBe(true);
  });
  it('does not forward saved credentials to a changed origin, scheme, port or provider', () => {
    for (const baseURL of ['https://other.example/v1', 'http://api.example.com/v1', 'https://api.example.com:8443/v1', 'invalid']) {
      expect(canReuseAiCredential(previous, { ...previous, baseURL })).toBe(false);
    }
    expect(canReuseAiCredential(previous, { ...previous, provider: 'openai' })).toBe(false);
  });
});
