export interface PdfTextItemLike {
  str: string;
}

export type PdfTextMatchStrategy = 'full' | 'sentence' | 'fuzzy' | 'none';

export interface PdfTextMatchResult {
  itemIndexes: number[];
  score: number;
  strategy: PdfTextMatchStrategy;
}

interface NormalizedCharacter {
  value: string;
  itemIndex: number;
}

interface NormalizedToken {
  value: string;
  itemIndex: number;
}

const HYPHEN_PATTERN = /[-\u00ad\u2010-\u2015]/u;
const SEARCHABLE_CHARACTER_PATTERN = /[\p{L}\p{N}]/u;
const MIN_SENTENCE_LENGTH = 36;
const MIN_PARTIAL_MATCH_SCORE = 0.75;
const MIN_FUZZY_SCORE = 0.75;

export function normalizePdfSearchText(text: string): string {
  return buildNormalizedCharacters([{ str: text }])
    .map((character) => character.value)
    .join('')
    .trim();
}

export function findTextItemMatches(items: PdfTextItemLike[], query: string): number[] {
  return findBestTextItemMatch(items, query).itemIndexes;
}

export function findBestTextItemMatch(items: PdfTextItemLike[], query: string): PdfTextMatchResult {
  const normalizedQuery = normalizePdfSearchText(query);

  if (!normalizedQuery) {
    return noMatch();
  }

  const normalizedCharacters = buildNormalizedCharacters(items);
  const normalizedDocument = normalizedCharacters.map((character) => character.value).join('');
  const fullMatch = findCharacterRangeMatch(normalizedCharacters, normalizedDocument, normalizedQuery);

  if (fullMatch.itemIndexes.length > 0) {
    return { ...fullMatch, score: 1, strategy: 'full' };
  }

  const sentenceMatch = findBestSentenceMatch(normalizedCharacters, normalizedDocument, query);
  if (sentenceMatch.itemIndexes.length > 0) {
    return sentenceMatch;
  }

  return findBestFuzzyTokenMatch(items, query);
}

function findBestSentenceMatch(
  normalizedCharacters: NormalizedCharacter[],
  normalizedDocument: string,
  query: string
): PdfTextMatchResult {
  const normalizedQuery = normalizePdfSearchText(query);
  const candidates = splitSentences(query)
    .map((sentence) => normalizePdfSearchText(sentence))
    .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH);

  const matchedItemIndexes = new Set<number>();
  const matchedSentences = new Set<string>();
  let matchedLength = 0;

  for (const sentence of candidates) {
    if (matchedSentences.has(sentence)) {
      continue;
    }

    const match = findCharacterRangeMatch(normalizedCharacters, normalizedDocument, sentence);
    if (match.itemIndexes.length === 0) {
      continue;
    }

    matchedSentences.add(sentence);
    matchedLength += sentence.length;
    match.itemIndexes.forEach((itemIndex) => matchedItemIndexes.add(itemIndex));
  }

  const score = matchedLength / Math.max(normalizedQuery.length, matchedLength);

  if (score < MIN_PARTIAL_MATCH_SCORE || matchedItemIndexes.size === 0) {
    return noMatch();
  }

  return {
    itemIndexes: Array.from(matchedItemIndexes).sort((left, right) => left - right),
    score,
    strategy: 'sentence'
  };
}

function findBestFuzzyTokenMatch(items: PdfTextItemLike[], query: string): PdfTextMatchResult {
  const documentTokens = buildNormalizedTokens(items);
  const queryTokens = buildNormalizedTokens([{ str: query }]).map((token) => token.value);

  if (documentTokens.length === 0 || queryTokens.length === 0) {
    return noMatch();
  }

  const queryTokenCounts = countTokens(queryTokens);
  const minWindowLength = Math.max(3, Math.floor(queryTokens.length * 0.65));
  const maxWindowLength = Math.min(documentTokens.length, Math.ceil(queryTokens.length * 1.35));
  let best: PdfTextMatchResult = noMatch();

  for (let start = 0; start < documentTokens.length; start += 1) {
    for (let windowLength = minWindowLength; windowLength <= maxWindowLength; windowLength += 1) {
      const end = start + windowLength;
      if (end > documentTokens.length) {
        break;
      }

      const windowTokens = documentTokens.slice(start, end);
      const overlap = countTokenOverlap(countTokens(windowTokens.map((token) => token.value)), queryTokenCounts);
      const coverage = overlap / queryTokens.length;
      const precision = overlap / windowTokens.length;
      const orderBonus = calculateOrderedPrefixBonus(
        windowTokens.map((token) => token.value),
        queryTokens
      );
      const score = coverage * 0.65 + precision * 0.25 + orderBonus * 0.1;

      if (score > best.score) {
        best = {
          itemIndexes: Array.from(new Set(windowTokens.map((token) => token.itemIndex))).sort(
            (left, right) => left - right
          ),
          score,
          strategy: score >= MIN_FUZZY_SCORE ? 'fuzzy' : 'none'
        };
      }
    }
  }

  return best.strategy === 'fuzzy' ? best : noMatch();
}

function findCharacterRangeMatch(
  normalizedCharacters: NormalizedCharacter[],
  normalizedDocument: string,
  normalizedQuery: string
): Pick<PdfTextMatchResult, 'itemIndexes'> {
  const startIndex = normalizedDocument.indexOf(normalizedQuery);

  if (startIndex < 0) {
    return { itemIndexes: [] };
  }

  const endIndex = startIndex + normalizedQuery.length;
  const matchedItemIndexes = new Set<number>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const itemIndex = normalizedCharacters[index]?.itemIndex;
    if (itemIndex !== undefined) {
      matchedItemIndexes.add(itemIndex);
    }
  }

  return { itemIndexes: Array.from(matchedItemIndexes).sort((left, right) => left - right) };
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildNormalizedCharacters(items: PdfTextItemLike[]): NormalizedCharacter[] {
  const characters: NormalizedCharacter[] = [];
  let previousWasSpace = false;
  let skipWhitespaceAfterHyphen = false;

  items.forEach((item, itemIndex) => {
    for (const rawCharacter of item.str.normalize('NFKC')) {
      const lowerCharacter = rawCharacter.toLocaleLowerCase();

      if (HYPHEN_PATTERN.test(lowerCharacter)) {
        // 论文 PDF 经常把换行处单词拆成 zero- / shot；去掉连字符能让这类片段继续匹配。
        skipWhitespaceAfterHyphen = true;
        continue;
      }

      if (!SEARCHABLE_CHARACTER_PATTERN.test(lowerCharacter)) {
        if (skipWhitespaceAfterHyphen) {
          continue;
        }

        if (characters.length > 0 && !previousWasSpace) {
          characters.push({ value: ' ', itemIndex });
          previousWasSpace = true;
        }
        continue;
      }

      characters.push({ value: lowerCharacter, itemIndex });
      previousWasSpace = false;
      skipWhitespaceAfterHyphen = false;
    }
  });

  if (characters.at(-1)?.value === ' ') {
    characters.pop();
  }

  return characters;
}

function buildNormalizedTokens(items: PdfTextItemLike[]): NormalizedToken[] {
  const characters = buildNormalizedCharacters(items);
  const tokens: NormalizedToken[] = [];
  let current = '';
  let currentItemIndex = 0;

  characters.forEach((character) => {
    if (character.value === ' ') {
      if (current) {
        tokens.push({ value: current, itemIndex: currentItemIndex });
        current = '';
      }
      return;
    }

    if (!current) {
      currentItemIndex = character.itemIndex;
    }
    current += character.value;
  });

  if (current) {
    tokens.push({ value: current, itemIndex: currentItemIndex });
  }

  return tokens;
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  tokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));
  return counts;
}

function countTokenOverlap(left: Map<string, number>, right: Map<string, number>): number {
  let overlap = 0;
  left.forEach((count, token) => {
    overlap += Math.min(count, right.get(token) ?? 0);
  });
  return overlap;
}

function calculateOrderedPrefixBonus(windowTokens: string[], queryTokens: string[]): number {
  let matches = 0;
  const maxLength = Math.min(windowTokens.length, queryTokens.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (windowTokens[index] !== queryTokens[index]) {
      break;
    }
    matches += 1;
  }

  return maxLength === 0 ? 0 : matches / maxLength;
}

function noMatch(): PdfTextMatchResult {
  return {
    itemIndexes: [],
    score: 0,
    strategy: 'none'
  };
}
