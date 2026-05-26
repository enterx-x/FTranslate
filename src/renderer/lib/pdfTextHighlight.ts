export interface PdfTextItemLike {
  str: string;
}

interface NormalizedCharacter {
  value: string;
  itemIndex: number;
}

const HYPHEN_PATTERN = /[-\u00ad\u2010-\u2015]/u;
const SEARCHABLE_CHARACTER_PATTERN = /[\p{L}\p{N}]/u;

export function normalizePdfSearchText(text: string): string {
  return buildNormalizedCharacters([{ str: text }])
    .map((character) => character.value)
    .join('')
    .trim();
}

export function findTextItemMatches(items: PdfTextItemLike[], query: string): number[] {
  const normalizedQuery = normalizePdfSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  const normalizedCharacters = buildNormalizedCharacters(items);
  const normalizedDocument = normalizedCharacters.map((character) => character.value).join('');
  const startIndex = normalizedDocument.indexOf(normalizedQuery);

  if (startIndex < 0) {
    return [];
  }

  const endIndex = startIndex + normalizedQuery.length;
  const matchedItemIndexes = new Set<number>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const itemIndex = normalizedCharacters[index]?.itemIndex;
    if (itemIndex !== undefined) {
      matchedItemIndexes.add(itemIndex);
    }
  }

  return Array.from(matchedItemIndexes).sort((left, right) => left - right);
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
