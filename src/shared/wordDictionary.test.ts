import { describe, expect, it } from 'vitest';
import {
  isSingleEnglishDictionaryWord,
  normalizeEnglishDictionaryWord,
  parseFreeDictionaryResponse
} from './wordDictionary';

describe('wordDictionary', () => {
  it('accepts one English lexical token and rejects phrases or mixed scripts', () => {
    expect(normalizeEnglishDictionaryWord('Models')).toBe('models');
    expect(normalizeEnglishDictionaryWord("researcher's")).toBe("researcher's");
    expect(isSingleEnglishDictionaryWord('physics-informed')).toBe(true);
    expect(isSingleEnglishDictionaryWord('world model')).toBe(false);
    expect(isSingleEnglishDictionaryWord('模型')).toBe(false);
  });

  it('normalizes phonetics, parts of speech, definitions and attribution', () => {
    expect(
      parseFreeDictionaryResponse([
        {
          word: 'model',
          phonetic: '/ˈmɒdl̩/',
          phonetics: [
            { text: '/ˈmɒdl̩/', audio: '' },
            { text: '/ˈmɑdl̩/', audio: 'https://api.dictionaryapi.dev/model-us.mp3' }
          ],
          meanings: [
            {
              partOfSpeech: 'noun',
              definitions: [
                {
                  definition: 'A simplified representation of a real-world system.',
                  example: 'The model predicts contact forces.',
                  synonyms: ['representation']
                }
              ],
              synonyms: ['pattern']
            }
          ],
          sourceUrls: ['https://en.wiktionary.org/wiki/model'],
          license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' }
        }
      ])
    ).toMatchObject({
      word: 'model',
      phonetics: ['/ˈmɒdl̩/', '/ˈmɑdl̩/'],
      audioUrl: 'https://api.dictionaryapi.dev/model-us.mp3',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition: 'A simplified representation of a real-world system.',
              example: 'The model predicts contact forces.',
              synonyms: ['representation']
            }
          ],
          synonyms: ['pattern']
        }
      ],
      sourceUrl: 'https://en.wiktionary.org/wiki/model',
      license: { name: 'CC BY-SA 3.0' }
    });
  });

  it('rejects malformed or definition-free payloads', () => {
    expect(parseFreeDictionaryResponse({ word: 'model' })).toBeNull();
    expect(parseFreeDictionaryResponse([{ word: 'model', meanings: [] }])).toBeNull();
  });
});
