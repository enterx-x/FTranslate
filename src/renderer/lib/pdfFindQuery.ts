export function buildOfficialFindQuery(queryText: string): string | string[] {
  const fragments = buildOfficialFindFragments(queryText);
  if (fragments.length === 0) {
    return '';
  }

  return fragments.length === 1 ? fragments[0] : fragments;
}

export function buildOfficialFindFragments(queryText: string): string[] {
  const trimmed = queryText.trim();
  if (!trimmed) {
    return [];
  }

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 32);

  // PDF.js 的原生搜索支持多段查询。这里保留全部句子，避免长段落只高亮前几句。
  if (sentences.length >= 2) {
    return sentences;
  }

  if (trimmed.length > 320) {
    return [trimmed.slice(0, 320)];
  }

  return [trimmed];
}
