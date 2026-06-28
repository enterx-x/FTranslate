import { describe, expect, it } from 'vitest';
import { readAppSettings } from './useAppSettings';

describe('readAppSettings', () => {
  it('returns default settings when localStorage has invalid JSON', () => {
    const settings = readAppSettings('{not-json');

    expect(settings.general.defaultHome).toBe('workspace');
    expect(settings.pdf.referenceTranslationStrategy).toBe('keep-original');
  });
});
