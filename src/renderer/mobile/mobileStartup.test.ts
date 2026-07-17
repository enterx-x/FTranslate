import { describe, expect, it } from 'vitest';
import { resolveMobileStartupState } from './mobileStartup';
import { createImportedMobilePaper, type MobileStoredPdf, type MobileTranslationSession } from './mobileTypes';

const sourcePdf: MobileStoredPdf = {
  path: 'papers/saved/source/paper.pdf',
  fileName: 'paper.pdf',
  kind: 'source',
  byteLength: 120
};
const defaults: MobileTranslationSession = {
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  apiKey: ''
};

describe('mobile startup persistence recovery', () => {
  it('restores the paper library even when translation preferences fail to load', () => {
    const paper = createImportedMobilePaper({ id: 'saved', fileName: 'paper.pdf', storedPdf: sourcePdf });
    const error = new Error('preferences unavailable');
    const resolved = resolveMobileStartupState({
      libraryResult: { status: 'fulfilled', value: [paper] },
      preferencesResult: { status: 'rejected', reason: error },
      currentLibrary: [],
      currentPreferences: defaults,
      libraryChanged: false,
      preferencesChanged: false
    });

    expect(resolved.library).toEqual([paper]);
    expect(resolved.preferences).toEqual(defaults);
    expect(resolved.errors).toEqual([error]);
  });

  it('keeps a newly saved API configuration when an older startup read returns later', () => {
    const current = {
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'local-key'
    };
    const resolved = resolveMobileStartupState({
      libraryResult: { status: 'fulfilled', value: [] },
      preferencesResult: { status: 'fulfilled', value: defaults },
      currentLibrary: [],
      currentPreferences: current,
      libraryChanged: false,
      preferencesChanged: true
    });

    expect(resolved.preferences).toBe(current);
  });
});
