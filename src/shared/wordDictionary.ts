export type WordDictionaryLookupStatus = 'found' | 'not-found' | 'unavailable';

export interface WordDictionaryDefinition {
  definition: string;
  example?: string;
  synonyms: string[];
  antonyms: string[];
}

export interface WordDictionaryMeaning {
  partOfSpeech: string;
  definitions: WordDictionaryDefinition[];
  synonyms: string[];
  antonyms: string[];
}

export interface EnglishWordDictionaryEntry {
  word: string;
  phonetics: string[];
  audioUrl?: string;
  meanings: WordDictionaryMeaning[];
  sourceUrl?: string;
  license?: {
    name: string;
    url?: string;
  };
}

export interface WordDictionaryLookupResult {
  status: WordDictionaryLookupStatus;
  message: string;
  entry?: EnglishWordDictionaryEntry;
}

const SINGLE_ENGLISH_WORD_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/u;
const MAX_MEANINGS = 8;
const MAX_DEFINITIONS_PER_MEANING = 6;
const MAX_RELATED_WORDS = 8;
const MAX_DICTIONARY_FIELD_LENGTH = 2_048;

export function normalizeEnglishDictionaryWord(value: string): string | null {
  const normalized = value.trim().replace(/’/gu, "'");
  if (!SINGLE_ENGLISH_WORD_PATTERN.test(normalized) || normalized.length > 64) {
    return null;
  }
  return normalized.toLocaleLowerCase('en-US');
}

export function isSingleEnglishDictionaryWord(value: string): boolean {
  return normalizeEnglishDictionaryWord(value) !== null;
}

export function parseFreeDictionaryResponse(payload: unknown): EnglishWordDictionaryEntry | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const entries = payload.filter(isRecord);
  const firstWord = entries.map((entry) => readString(entry.word)).find(Boolean);
  if (!firstWord) {
    return null;
  }

  const phonetics = uniqueStrings(
    entries.flatMap((entry) => [
      readString(entry.phonetic),
      ...readArray(entry.phonetics)
        .filter(isRecord)
        .map((phonetic) => readString(phonetic.text))
    ])
  ).slice(0, 4);
  const audioUrl = entries
    .flatMap((entry) => readArray(entry.phonetics))
    .filter(isRecord)
    .map((phonetic) => readHttpsUrl(phonetic.audio))
    .find(Boolean);
  const meanings = entries
    .flatMap((entry) => readArray(entry.meanings))
    .filter(isRecord)
    .map(parseMeaning)
    .filter((meaning): meaning is WordDictionaryMeaning => meaning !== null)
    .slice(0, MAX_MEANINGS);
  if (meanings.length === 0) {
    return null;
  }

  const sourceUrl = entries
    .flatMap((entry) => readArray(entry.sourceUrls))
    .map(readHttpsUrl)
    .find(Boolean);
  const licenseRecord = entries.map((entry) => entry.license).find(isRecord);
  const licenseName = licenseRecord ? readString(licenseRecord.name) : '';
  const licenseUrl = licenseRecord ? readHttpsUrl(licenseRecord.url) : undefined;

  return {
    word: firstWord,
    phonetics,
    ...(audioUrl ? { audioUrl } : {}),
    meanings,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(licenseName ? { license: { name: licenseName, ...(licenseUrl ? { url: licenseUrl } : {}) } } : {})
  };
}

function parseMeaning(value: Record<string, unknown>): WordDictionaryMeaning | null {
  const partOfSpeech = readString(value.partOfSpeech);
  const definitions = readArray(value.definitions)
    .filter(isRecord)
    .map((definition) => {
      const text = readString(definition.definition);
      if (!text) {
        return null;
      }
      const example = readString(definition.example);
      return {
        definition: text,
        ...(example ? { example } : {}),
        synonyms: uniqueStrings(readArray(definition.synonyms).map(readString)).slice(0, MAX_RELATED_WORDS),
        antonyms: uniqueStrings(readArray(definition.antonyms).map(readString)).slice(0, MAX_RELATED_WORDS)
      };
    })
    .filter((definition): definition is WordDictionaryDefinition => definition !== null)
    .slice(0, MAX_DEFINITIONS_PER_MEANING);
  if (!partOfSpeech || definitions.length === 0) {
    return null;
  }
  return {
    partOfSpeech,
    definitions,
    synonyms: uniqueStrings(readArray(value.synonyms).map(readString)).slice(0, MAX_RELATED_WORDS),
    antonyms: uniqueStrings(readArray(value.antonyms).map(readString)).slice(0, MAX_RELATED_WORDS)
  };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_DICTIONARY_FIELD_LENGTH) : '';
}

function readHttpsUrl(value: unknown): string | undefined {
  const candidate = readString(value);
  if (!candidate) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
