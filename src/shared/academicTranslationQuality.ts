export type AcademicTranslationMode = 'title' | 'abstract' | 'paragraph';

interface AcademicTranslationRepairOptions {
  mode?: AcademicTranslationMode;
  maxMissingTerms?: number;
}

const COMMON_ACADEMIC_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'based',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'using',
  'via',
  'we',
  'with'
]);

const MAX_TERM_LENGTH = 72;

export function repairAcademicTranslation(
  source: string,
  translated: string,
  options: AcademicTranslationRepairOptions = {}
): string {
  const normalizedTranslation = stripVisibleTermAnnotations(normalizeTranslationSpacing(translated));
  if (isPureRepeatedTranslationNoise(normalizedTranslation)) {
    return '';
  }

  const collapsedTranslation = collapseLocalRepeatedFragments(
    collapseRepeatedTranslationTail(collapseLocalRepeatedFragments(normalizedTranslation))
  );
  const cleaned = repairDamagedLatinTerms(source, collapsedTranslation);
  if (!cleaned) {
    return '';
  }

  const withLeadingTerm = restoreLeadingProtectedTerm(source, cleaned);
  const repaired = maybeFallbackLowQualityTitle(source, withLeadingTerm, options);
  if (isShortDegenerateTranslation(repaired)) {
    return repaired;
  }

  if (options.mode === 'title') {
    return repaired;
  }
  return prefixMissingAcademicTerms(source, repaired, options);
}

export function collapseRepeatedTranslationTail(value: string): string {
  let text = value.trim();
  if (!text) {
    return '';
  }

  for (let unitLength = 1; unitLength <= Math.min(32, Math.floor(text.length / 3)); unitLength += 1) {
    const unit = text.slice(-unitLength);
    if (!unit.trim()) {
      continue;
    }

    let repeatedLength = unitLength;
    while (
      repeatedLength + unitLength <= text.length &&
      text.slice(text.length - repeatedLength - unitLength, text.length - repeatedLength) === unit
    ) {
      repeatedLength += unitLength;
    }

    if (repeatedLength >= unitLength * 3) {
      text = text.slice(0, text.length - repeatedLength + unitLength).trim();
      unitLength = 0;
    }
  }

  return collapseRepeatedSentences(collapseRepeatedTrailingClauses(text));
}

export function collapseLocalRepeatedFragments(value: string): string {
  return value
    .replace(/([，。；：、,.!?;:])\1+/gu, '$1')
    .replace(/([\u3400-\u9fff]{1,4})\1{1,}/gu, '$1')
    .replace(/\b([A-Za-z][A-Za-z0-9-]{2,}(?:\s+[A-Za-z][A-Za-z0-9-]{2,}){0,3})\s+\1\b/giu, '$1')
    .trim();
}

export function extractProtectedAcademicTerms(source: string): string[] {
  const terms: string[] = [];
  const addTerm = (term: string): void => {
    const cleaned = normalizeProtectedTerm(term);
    if (!cleaned || cleaned.length > MAX_TERM_LENGTH || terms.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      return;
    }
    terms.push(cleaned);
  };

  const leadingName = source.match(/^\s*([A-Za-z][A-Za-z0-9+_.-]{1,52})\s*[:：]/u);
  if (leadingName?.[1]) {
    addTerm(leadingName[1]);
  }

  const normalizedSource = source.replace(/[()[\]{}]/gu, ' ');
  [
    /\bFull-Hand\s+Tactile\s+Representations?\b/giu,
    /\bDexterous\s+Full-Hand\s+Tactile\s+Representations?\b/giu,
    /\bEgocentric\s+Vision\b/giu,
    /\bVision-Based\s+Tactile\s+Simulation\b/giu,
    /\bTactile\s+Simulation\b/giu,
    /\bWorld\s+Model\b/giu,
    /\bFoundation\s+Model\b/giu,
    /\bControl\s+Barrier\s+Function\b/giu
  ].forEach((pattern) => {
    for (const match of normalizedSource.matchAll(pattern)) {
      addTerm(match[0]);
    }
  });

  for (const match of normalizedSource.matchAll(/\b[A-Z]{2,}(?:[-_][A-Z0-9]{2,})*\b/gu)) {
    addTerm(match[0]);
  }
  for (const match of normalizedSource.matchAll(/\b[A-Za-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/gu)) {
    addTerm(match[0]);
  }
  for (const match of normalizedSource.matchAll(/\b(?:[A-Z][A-Za-z0-9]+|[A-Z]{2,}|[A-Za-z]+-[A-Za-z]+)(?:\s+(?:[A-Z][A-Za-z0-9]+|[A-Z]{2,}|[A-Za-z]+-[A-Za-z]+)){1,5}\b/gu)) {
    if (shouldPreserveAcademicPhrase(match[0])) {
      addTerm(match[0]);
    }
  }
  for (const match of normalizedSource.matchAll(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+){1,}\b/gu)) {
    const token = match[0];
    const segments = token.split('-');
    if (segments.length >= 3 || /^[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+$/u.test(token) || shouldPreserveAcademicPhrase(token)) {
      addTerm(token);
    }
  }

  return terms;
}

function restoreLeadingProtectedTerm(source: string, translated: string): string {
  const leading = extractProtectedAcademicTerms(source)[0];
  const sourceLeadingMatch = source.match(/^\s*([A-Za-z][A-Za-z0-9+_.-]{1,52})\s*[:：]/u);
  if (!leading || !sourceLeadingMatch || containsProtectedTerm(translated, leading)) {
    return translated;
  }

  const separatorIndex = findFirstTitleSeparator(translated);
  if (separatorIndex < 0 || separatorIndex > 24) {
    return `${leading}：${translated}`;
  }

  return `${leading}${translated.slice(separatorIndex)}`;
}

function maybeFallbackLowQualityTitle(
  source: string,
  translated: string,
  options: AcademicTranslationRepairOptions
): string {
  if (options.mode !== 'title') {
    return translated;
  }

  const missingTerms = extractProtectedAcademicTerms(source)
    .filter((term) => shouldAlwaysShowInTitle(term))
    .filter((term) => !containsProtectedTerm(translated, term))
    .slice(0, options.maxMissingTerms ?? 3);

  if (missingTerms.length === 0) {
    return translated;
  }

  return source.trim() || translated;
}

function prefixMissingAcademicTerms(
  source: string,
  translated: string,
  options: AcademicTranslationRepairOptions
): string {
  const missingTerms = extractProtectedAcademicTerms(source)
    .filter((term) => !containsProtectedTerm(translated, term))
    .slice(0, options.maxMissingTerms ?? 4);

  if (missingTerms.length === 0) {
    return translated;
  }

  return `${missingTerms.join(' / ')}：${translated}`;
}

function findFirstTitleSeparator(value: string): number {
  const candidates = [value.indexOf('：'), value.indexOf(':'), value.indexOf(' - '), value.indexOf('—')].filter(
    (index) => index >= 0
  );
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function containsProtectedTerm(value: string, term: string): boolean {
  return value.toLowerCase().includes(term.toLowerCase());
}

function repairDamagedLatinTerms(source: string, translated: string): string {
  const terms = extractProtectedAcademicTerms(source).filter((term) => /[A-Za-z]/u.test(term));
  if (terms.length === 0) {
    return translated;
  }

  return translated.replace(/\b[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z][A-Za-z0-9-]*){0,3}\b/gu, (token) => {
    const normalizedToken = normalizeTermForDistance(token);
    if (normalizedToken.length < 5) {
      return token;
    }

    const nearest = terms
      .map((term) => ({
        term,
        distance: levenshteinDistance(normalizedToken, normalizeTermForDistance(term))
      }))
      .sort((left, right) => left.distance - right.distance)[0];

    if (!nearest) {
      return token;
    }

    const normalizedTerm = normalizeTermForDistance(nearest.term);
    const maxDistance = Math.max(2, Math.floor(normalizedTerm.length * 0.32));
    const samePrefix = normalizedToken.slice(0, 4) === normalizedTerm.slice(0, 4);
    return samePrefix && nearest.distance > 0 && nearest.distance <= maxDistance ? nearest.term : token;
  });
}

function normalizeTranslationSpacing(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function stripVisibleTermAnnotations(value: string): string {
  let text = value;
  const annotationPattern =
    /[（(]\s*(?:保留术语|术语|保留名词|保留英文|missing terms?|kept terms?)\s*[:：]\s*[^）)]*[）)]/giu;
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(annotationPattern, '');
  }
  return text.replace(/\s+([，。；：、,.!?;:])/gu, '$1').replace(/\s+/gu, ' ').trim();
}

function isPureRepeatedTranslationNoise(value: string): boolean {
  const compact = value.replace(/\s+/gu, '');
  if (!compact) {
    return true;
  }

  if (compact.length < 6) {
    return false;
  }

  for (let unitLength = 1; unitLength <= Math.min(8, Math.floor(compact.length / 3)); unitLength += 1) {
    if (compact.length % unitLength !== 0) {
      continue;
    }
    const unit = compact.slice(0, unitLength);
    if (unit.repeat(compact.length / unitLength) === compact) {
      return true;
    }
  }

  const uniqueCharacters = new Set(Array.from(compact));
  return compact.length >= 10 && uniqueCharacters.size <= 2;
}

function normalizeProtectedTerm(value: string): string {
  const cleaned = value
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, '')
    .replace(/^(?:a|an|the)\s+/iu, '')
    .replace(/\s+(?:a|an|the)$/iu, '')
    .trim();
  if (!cleaned) {
    return '';
  }

  const lower = cleaned.toLowerCase();
  if (COMMON_ACADEMIC_WORDS.has(lower) || lower.endsWith('-based')) {
    return '';
  }
  if (/^\d+$/u.test(cleaned)) {
    return '';
  }

  return cleaned;
}

function shouldPreserveAcademicPhrase(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > MAX_TERM_LENGTH) {
    return false;
  }

  const words = cleaned.split(/\s+/u).filter(Boolean);
  if (words.length > 6) {
    return false;
  }

  return (
    /[A-Z]{2,}|[A-Za-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Za-z0-9]+-[A-Za-z0-9]+/u.test(cleaned) ||
    /\b(Egocentric|Tactile|Haptic|Dexterous|Full-Hand|Vision|FEM|Cauchy|Sim-to-Real|World Model|Foundation Model|Control Barrier|MPC|CBF|PINN|VLA|VLM)\b/iu.test(cleaned)
  );
}

function shouldAlwaysShowInTitle(term: string): boolean {
  return (
    /^[A-Z]{2,}(?:[-_][A-Z0-9]{2,})*$/u.test(term) ||
    /[A-Za-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*/u.test(term) ||
    /\b(Egocentric Vision|Full-Hand Tactile|Vision-Based|Sim-to-Real|World Model|Foundation Model|Control Barrier|CBF|MPC|PINN|VLA|VLM|FEM)\b/iu.test(term)
  );
}

function normalizeTermForDistance(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return right.length;
  }
  if (!right) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function isShortDegenerateTranslation(value: string): boolean {
  const normalized = value.replace(/\s+/gu, '').trim();
  const cjkCount = normalized.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const latinCount = normalized.match(/[A-Za-z]/gu)?.length ?? 0;
  return cjkCount > 0 && cjkCount < 4 && latinCount === 0;
}

function collapseRepeatedSentences(value: string): string {
  const sentencePattern = /(.{3,80}[。.!?！？])\1{2,}$/u;
  let text = value;
  let match = text.match(sentencePattern);
  while (match?.[1]) {
    text = text.slice(0, text.length - match[1].length * 2).trim();
    match = text.match(sentencePattern);
  }
  return text;
}

interface TranslationClause {
  text: string;
  separator: string;
}

function collapseRepeatedTrailingClauses(value: string): string {
  let clauses = parseTranslationClauses(value);
  if (clauses.length < 2) {
    return value;
  }

  let changed = false;
  while (clauses.length >= 2) {
    const lastIndex = clauses.length - 1;
    const previousIndex = clauses.length - 2;
    const last = clauses[lastIndex];
    const previous = clauses[previousIndex];
    const normalizedLast = normalizeRepeatedClauseText(last.text);
    const normalizedPrevious = normalizeRepeatedClauseText(previous.text);

    if (
      normalizedLast.length < 8 ||
      normalizedLast !== normalizedPrevious ||
      !hasTerminalPunctuation(last.separator)
    ) {
      break;
    }

    clauses = clauses.slice(0, lastIndex);
    clauses[previousIndex] = {
      ...previous,
      separator: chooseTerminalPunctuation(last.separator)
    };
    changed = true;
  }

  return changed ? clauses.map((clause) => `${clause.text}${clause.separator}`).join('').trim() : value;
}

function parseTranslationClauses(value: string): TranslationClause[] {
  const clauses: TranslationClause[] = [];
  const pattern = /([^，,；;。.!?！？]+)([，,；;。.!?！？]*|$)/gu;
  for (const match of value.matchAll(pattern)) {
    const text = match[1]?.trim() ?? '';
    if (!text) {
      continue;
    }
    clauses.push({
      text,
      separator: match[2] ?? ''
    });
  }
  return clauses;
}

function normalizeRepeatedClauseText(value: string): string {
  return value.replace(/\s+/gu, '');
}

function hasTerminalPunctuation(value: string): boolean {
  return /[。.!?！？]/u.test(value);
}

function chooseTerminalPunctuation(value: string): string {
  return value.match(/[。.!?！？]/u)?.[0] ?? '。';
}
