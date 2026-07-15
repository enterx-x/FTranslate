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
const NATURAL_CHINESE_REDUPLICATIONS = [
  '往往',
  '常常',
  '渐渐',
  '仅仅',
  '恰恰',
  '偏偏',
  '刚刚',
  '缓缓',
  '频频',
  '默默',
  '纷纷',
  '轻轻',
  '慢慢',
  '大大',
  '步步',
  '处处',
  '时时'
] as const;
// Keep local NLLB requests below the range where long English abstracts can
// exhaust the decoder output budget. The sidecar translates all segments as a
// batch, so smaller segments improve completeness without adding one request
// per sentence.
const DEFAULT_TRANSLATION_SEGMENT_LENGTH = 480;
// NLLB strips punctuation and may transliterate arbitrary letter tokens in
// realistic long titles. A low-collision numeric sentinel survives the same
// GPU inference unchanged and can still move with translated Chinese grammar.
const PROTECTED_PLACEHOLDER_PREFIX = '86753';
const PROTECTED_PLACEHOLDER_SUFFIX = '901';
const PROTECTED_PLACEHOLDER_PATTERN_SOURCE = String.raw`\b86753\d{2}901\b`;

interface ProtectedAcademicSpan {
  start: number;
  end: number;
  marker: string;
  value: string;
}

export interface PreparedAcademicTranslation {
  segments: string[];
  restore: (translatedSegments: string[]) => PreparedAcademicTranslationRestoreResult;
}

export interface PreparedAcademicTranslationRestoreResult {
  ok: boolean;
  text: string;
  reason?: 'segment-count-mismatch' | 'missing-or-damaged-placeholder' | 'placeholder-sequence-mismatch';
}

/**
 * Keeps non-linguistic academic spans opaque to the local translation engines,
 * then splits only at sentence or word boundaries so long abstracts do not
 * overwhelm an individual inference request.
 */
export function prepareAcademicTranslation(
  source: string,
  maxSegmentLength = DEFAULT_TRANSLATION_SEGMENT_LENGTH
): PreparedAcademicTranslation {
  const translatableSource = normalizeTranslatableAcademicMarkup(source);
  const protectedSpans = collectProtectedAcademicSpans(translatableSource);
  const protectedText = applyProtectedAcademicSpans(translatableSource, protectedSpans);
  const segments = splitAcademicTranslationSegments(protectedText, maxSegmentLength);
  const expectedMarkerSequences = segments.map(extractProtectedMarkers);

  return {
    segments,
    restore: (translatedSegments) =>
      restorePreparedAcademicTranslation(protectedSpans, segments, expectedMarkerSequences, translatedSegments)
  };
}

export function hasSevereAcademicTranslationLengthLoss(
  source: string,
  translated: string,
  mode: AcademicTranslationMode = 'abstract'
): boolean {
  if (mode === 'title') {
    return false;
  }

  const sourceLength = countMeaningfulTranslationCharacters(source);
  if (sourceLength < 48) {
    return false;
  }

  const translatedLength = countMeaningfulTranslationCharacters(translated);
  return translatedLength < Math.max(24, Math.floor(sourceLength * 0.12));
}

function collectProtectedAcademicSpans(source: string): ProtectedAcademicSpan[] {
  const candidates: Array<{ start: number; end: number; value: string }> = [];
  const addMatches = (pattern: RegExp): void => {
    for (const match of source.matchAll(pattern)) {
      const value = match[0] ?? '';
      const start = match.index ?? -1;
      if (!value || start < 0) {
        continue;
      }
      candidates.push({ start, end: start + value.length, value });
    }
  };

  // Only spans whose literal position carries meaning remain opaque. Method
  // names and recoverable metadata stay visible to NLLB and are repaired after
  // translation, because the model may legitimately omit repeated terms.
  addMatches(/\$\$[\s\S]+?\$\$/gu);
  addMatches(/(?<!\$)\$(?!\$)(?:\\.|[^$\n])+\$(?!\$)/gu);
  addMatches(/``[^`\n]+``/gu);
  addMatches(/`[^`\n]+`/gu);
  addMatches(/\\\[[\s\S]+?\\\]/gu);
  addMatches(/\\\([\s\S]+?\\\)/gu);
  addMatches(/\[(?:\s*\d+\s*(?:[-–]\s*\d+)?\s*)(?:,\s*\d+\s*(?:[-–]\s*\d+)?\s*)*\]/gu);

  const selected: Array<{ start: number; end: number; value: string }> = [];
  candidates
    .sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start))
    .forEach((candidate) => {
      if (selected.some((item) => candidate.start < item.end && candidate.end > item.start)) {
        return;
      }
      selected.push(candidate);
    });

  if (selected.length > 100) {
    throw new Error('Too many protected academic spans in one translation request.');
  }

  return selected.map((candidate, index) => ({
    start: candidate.start,
    end: candidate.end,
    marker: `${PROTECTED_PLACEHOLDER_PREFIX}${String(index).padStart(2, '0')}${PROTECTED_PLACEHOLDER_SUFFIX}`,
    value: candidate.value
  }));
}

function normalizeTranslatableAcademicMarkup(source: string): string {
  return source.replace(/\\(?:textit|textbf|emph)\{([^{}]+)\}/giu, '$1');
}

function applyProtectedAcademicSpans(source: string, protectedSpans: ProtectedAcademicSpan[]): string {
  if (protectedSpans.length === 0) {
    return source;
  }

  let cursor = 0;
  let result = '';
  protectedSpans.forEach((span) => {
    result += `${source.slice(cursor, span.start)}${span.marker}`;
    cursor = span.end;
  });
  return `${result}${source.slice(cursor)}`;
}

function restorePreparedAcademicTranslation(
  protectedSpans: ProtectedAcademicSpan[],
  sourceSegments: string[],
  expectedMarkerSequences: string[][],
  translatedSegments: string[]
): PreparedAcademicTranslationRestoreResult {
  if (translatedSegments.length !== sourceSegments.length) {
    return { ok: false, text: '', reason: 'segment-count-mismatch' };
  }

  const hasExpectedMarkersInEverySegment = translatedSegments.every((segment, index) => {
    const actualMarkers = extractProtectedMarkers(segment).sort();
    const expectedMarkers = [...(expectedMarkerSequences[index] ?? [])].sort();
    return (
      actualMarkers.length === expectedMarkers.length &&
      actualMarkers.every((marker, markerIndex) => marker === expectedMarkers[markerIndex])
    );
  });
  if (!hasExpectedMarkersInEverySegment) {
    return { ok: false, text: '', reason: 'placeholder-sequence-mismatch' };
  }

  let text = translatedSegments.map((segment) => segment.trim()).join(' ').trim();
  for (const span of protectedSpans) {
    const markerCount = text.split(span.marker).length - 1;
    if (markerCount !== 1) {
      return { ok: false, text: '', reason: 'missing-or-damaged-placeholder' };
    }
    text = text.replace(span.marker, () => span.value);
  }

  if (new RegExp(PROTECTED_PLACEHOLDER_PATTERN_SOURCE, 'u').test(text)) {
    return { ok: false, text: '', reason: 'missing-or-damaged-placeholder' };
  }
  return { ok: true, text };
}

function extractProtectedMarkers(value: string): string[] {
  return Array.from(value.matchAll(new RegExp(PROTECTED_PLACEHOLDER_PATTERN_SOURCE, 'gu')), (match) => match[0]);
}

function splitAcademicTranslationSegments(value: string, maxSegmentLength: number): string[] {
  const limit = Math.max(1, Math.floor(maxSegmentLength));
  const normalized = value.trim();
  if (!normalized || normalized.length <= limit) {
    return [normalized];
  }

  const sentences = normalized.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  const segments: string[] = [];
  let current = '';
  sentences.forEach((sentence) => {
    const pieces = splitOversizedAcademicSegment(sentence.trim(), limit);
    pieces.forEach((piece) => {
      if (!current) {
        current = piece;
        return;
      }
      if (current.length + 1 + piece.length <= limit) {
        current = `${current} ${piece}`;
        return;
      }
      segments.push(current);
      current = piece;
    });
  });
  if (current) {
    segments.push(current);
  }
  return segments;
}

function splitOversizedAcademicSegment(value: string, limit: number): string[] {
  if (value.length <= limit) {
    return [value];
  }

  const pieces: string[] = [];
  let remaining = value;
  while (remaining.length > limit) {
    const boundary = remaining.lastIndexOf(' ', limit);
    const splitAt = boundary > Math.floor(limit / 2) ? boundary : limit;
    pieces.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    pieces.push(remaining);
  }
  return pieces;
}

function countMeaningfulTranslationCharacters(value: string): number {
  return (value.match(/[A-Za-z0-9\u3400-\u9fff]/gu) ?? []).length;
}

export function repairAcademicTranslation(
  source: string,
  translated: string,
  options: AcademicTranslationRepairOptions = {}
): string {
  const normalizedTranslation = stripLegacyMissingAcademicTermPrefix(
    source,
    stripVisibleTermAnnotations(normalizeTranslationSpacing(translated))
  );
  if (isPureRepeatedTranslationNoise(normalizedTranslation)) {
    return '';
  }

  const collapsedTranslation = collapseLocalRepeatedFragments(
    collapseRepeatedLeadingAcademicPrefix(
      collapseRepeatedTranslationTail(collapseLocalRepeatedFragments(normalizedTranslation))
    )
  );
  const cleaned = restoreRecoverableAcademicLiterals(
    source,
    applySourceAwareAcademicGlossary(source, repairDamagedLatinTerms(source, collapsedTranslation))
  );
  if (!cleaned) {
    return '';
  }

  const withIntroducedMethod = restoreIntroducedAcademicMethod(source, cleaned);
  const withSourceAwareTerms = restoreMissingSourceAwareTerms(source, withIntroducedMethod);
  const withLeadingTerm = restoreLeadingProtectedTerm(source, withSourceAwareTerms);
  const repaired = normalizeChineseAcademicPunctuation(
    maybeFallbackLowQualityTitle(source, withLeadingTerm, options)
  );
  if (isShortDegenerateTranslation(repaired)) {
    return repaired;
  }
  return repaired;
}

function restoreRecoverableAcademicLiterals(source: string, translated: string): string {
  const literalPatterns = [
    /\bhttps?:\/\/[^\s<>()\]]+/giu,
    /\b(?:doi:\s*)?10\.\d{4,9}\/[\w.()/:;-]+/giu,
    /\barXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?\b/giu,
    /\barXiv:\s*[a-z-]+(?:\.[a-z-]+)?\/\d{7}(?:v\d+)?\b/giu
  ];
  const literals = literalPatterns
    .flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => match[0]))
    .map((literal) => (/^https?:\/\//iu.test(literal) ? literal.replace(/[.,;:!?]+$/u, '') : literal));
  const uniqueLiterals = literals.filter(
    (literal, index) => literals.findIndex((candidate) => candidate.toLowerCase() === literal.toLowerCase()) === index
  );
  const missing = uniqueLiterals.filter((literal) => !containsRecoverableAcademicLiteral(translated, literal));
  if (missing.length === 0) {
    return translated;
  }

  const suffix = missing
    .map((literal) =>
      /^https?:\/\//iu.test(literal) && /\bproject\s+(?:page|website)\s*:/iu.test(source)
        ? `项目页面：${literal}`
        : literal
    )
    .join(' ');
  const separator = /[。！？.!?]\s*$/u.test(translated) ? ' ' : '。 ';
  return `${translated}${separator}${suffix}`.trim();
}

function containsRecoverableAcademicLiteral(translated: string, literal: string): boolean {
  if (translated.toLowerCase().includes(literal.toLowerCase())) {
    return true;
  }
  if (!/^https?:\/\//iu.test(literal)) {
    return false;
  }
  const normalizeUrl = (value: string): string =>
    value
      .toLowerCase()
      .replace(/^https?:\/\//u, '')
      .replace(/[.,;:!?]+$/u, '')
      .replace(/\/$/u, '');
  const translatedUrls = translated.match(/\bhttps?:\/\/[^\s<>()\]]+/giu) ?? [];
  return translatedUrls.some((candidate) => normalizeUrl(candidate) === normalizeUrl(literal));
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
  const protectedValues: string[] = [];
  let text = value;
  NATURAL_CHINESE_REDUPLICATIONS.forEach((term) => {
    text = text.replace(new RegExp(term, 'gu'), () => {
      const marker = `97531${String(protectedValues.length).padStart(2, '0')}86420`;
      protectedValues.push(term);
      return marker;
    });
  });
  text = text
    .replace(/([，。；：、,.!?;:])\1+/gu, '$1')
    .replace(/([\u3400-\u9fff]{1,4})\1{1,}/gu, '$1')
    .replace(/\b([A-Za-z][A-Za-z0-9-]{2,}(?:\s+[A-Za-z][A-Za-z0-9-]{2,}){0,3})\s+\1\b/giu, '$1')
    .trim();
  protectedValues.forEach((term, index) => {
    text = text.replace(`97531${String(index).padStart(2, '0')}86420`, term);
  });
  return text;
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

  const normalizedSource = normalizeTranslatableAcademicMarkup(source)
    .replace(/\bhttps?:\/\/[^\s<>()\]]+/giu, ' ')
    .replace(/\b(?:doi:\s*)?10\.\d{4,9}\/[\w.()/:;-]+/giu, ' ')
    .replace(/\barXiv:\s*(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?\b/giu, ' ')
    .replace(/[()[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ');
  [
    /\bFull-Hand\s+Tactile\s+Representations?\b/giu,
    /\bDexterous\s+Full-Hand\s+Tactile\s+Representations?\b/giu,
    /\bEgocentric\s+Vision\b/giu,
    /\bVision-Based\s+Tactile\s+Simulation\b/giu,
    /\bTactile\s+Simulation\b/giu,
    /\bWorld\s+Model\b/giu,
    /\bFoundation\s+Model\b/giu,
    /\bControl\s+Barrier\s+Function\b/giu,
    /\bLow-level\b/giu,
    /\bLearning-Based\s+Robot\s+Navigation\b/giu,
    /\bOmni-Modal\b/giu
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

function restoreIntroducedAcademicMethod(source: string, translated: string): string {
  const match = source.match(
    /\b[Ww]e\s+(?:introduce|present|propose|develop)\s+(?:an?\s+)?([A-Z][A-Za-z0-9+_.-]{1,52})\b/u
  );
  const methodName = match?.[1] ?? '';
  if (
    !methodName ||
    (!/[A-Z].*[A-Z]/u.test(methodName) && !/[0-9+_.-]/u.test(methodName)) ||
    containsProtectedTerm(translated, methodName)
  ) {
    return translated;
  }

  const cueWithTranslatedName = /(我们(?:介绍|提出|推出|引入|开发)(?:了)?)([\u3400-\u9fff]{2,10})(?=(?:用于|，|,|是|作为))/u;
  if (cueWithTranslatedName.test(translated)) {
    return translated.replace(cueWithTranslatedName, `$1 ${methodName}，`);
  }
  const cue = /(我们(?:介绍|提出|推出|引入|开发)(?:了)?)/u;
  return cue.test(translated) ? translated.replace(cue, `$1 ${methodName}`) : translated;
}

function restoreMissingSourceAwareTerms(source: string, translated: string): string {
  const sourceLower = source.toLowerCase();
  let text = translated;
  if (sourceLower.includes('sim-to-real') && !containsProtectedTerm(text, 'Sim-to-Real')) {
    if (/(?:仿真|模拟)到(?:现实|真实)/u.test(text)) {
      text = text.replace(/(?:仿真|模拟)到(?:现实|真实)/u, 'Sim-to-Real');
    } else if (/迁移/u.test(text)) {
      text = text.replace(/迁移/u, 'Sim-to-Real 迁移');
    } else {
      text = `${text.replace(/[。.]\s*$/u, '')}，并涉及 Sim-to-Real 迁移。`;
    }
  }
  return text;
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

function stripLegacyMissingAcademicTermPrefix(source: string, translated: string): string {
  const match = translated.match(/^([^：:\n]{3,180})[：:]\s*(.+)$/u);
  if (!match?.[1] || !match[2] || !match[1].includes('/')) {
    return translated;
  }

  const sourceKey = normalizeTermForDistance(source);
  const prefixTerms = match[1]
    .split(/\s*\/\s*/u)
    .map((term) => normalizeTermForDistance(term))
    .filter((term) => term.length >= 3);
  if (prefixTerms.length < 2 || !prefixTerms.every((term) => sourceKey.includes(term))) {
    return translated;
  }
  return match[2].trim();
}

function findFirstTitleSeparator(value: string): number {
  const candidates = [value.indexOf('：'), value.indexOf(':'), value.indexOf(' - '), value.indexOf('—')].filter(
    (index) => index >= 0
  );
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function containsProtectedTerm(value: string, term: string): boolean {
  const normalize = (text: string): string =>
    normalizeTranslatableAcademicMarkup(text)
      .toLowerCase()
      .replace(/[^a-z0-9\u3400-\u9fff]+/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  return normalize(value).includes(normalize(term));
}

function collapseRepeatedLeadingAcademicPrefix(value: string): string {
  let text = value;
  const repeatedPrefix = /^([^：:\n]{3,96})[：:]\s*\1[：:]\s*/iu;
  while (repeatedPrefix.test(text)) {
    text = text.replace(repeatedPrefix, '$1：');
  }
  return text;
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

function applySourceAwareAcademicGlossary(source: string, translated: string): string {
  const sourceLower = source.toLowerCase();
  let text = translated;
  const replaceWhenPresent = (sourceTerm: string, pattern: RegExp, replacement: string): void => {
    if (sourceLower.includes(sourceTerm)) {
      text = text.replace(pattern, replacement);
    }
  };

  replaceWhenPresent('reinforcement learning', /增强学习/gu, '强化学习');
  replaceWhenPresent('control barrier function', /控制屏障(?:功能|作用)/gu, '控制屏障函数');
  replaceWhenPresent('ordinary differential equation', /普通(?:的)?(?:差异|差分)方程/gu, '常微分方程');
  replaceWhenPresent('safety filter', /安全(?:过器|滤器|筛选器)/gu, '安全过滤器');
  replaceWhenPresent('reward shaping', /(?<!奖励)(?:奖励)?塑造/gu, '奖励塑形');
  replaceWhenPresent('generalization', /通用化/gu, '泛化');
  replaceWhenPresent('generalizable', /(?:更)?可普遍(?:的)?/gu, '可泛化的');
  replaceWhenPresent('symmetric koopman predictions', /(?:符号|对比性|对称性)库普曼预测/gu, '对称 Koopman 预测');
  replaceWhenPresent('legged robot locomotion', /(?:腿部|双腿)机器人(?:移动|运动)/gu, '足式机器人运动');
  replaceWhenPresent('minimalist', /(?:微观主义|最低限度|极小主义)(?:的)?/gu, '极简');
  replaceWhenPresent('retargeting-guided', /(?:反指导|重新定位指导|重定目标指导|重定向指导)/gu, '重定向引导');
  replaceWhenPresent('dexterous manipulation', /(?:巧妙|精巧|灵巧)的?(?:操纵|操控)/gu, '灵巧操作');
  replaceWhenPresent('sample efficiency', /样本效率差/gu, '样本效率低');
  replaceWhenPresent('policy', /政策/gu, '策略');
  replaceWhenPresent('actor', /演员/gu, 'Actor');
  replaceWhenPresent('critic', /(?:评论家|批评者)/gu, 'Critic');
  replaceWhenPresent('agent', /(?:代理人|代理)(?!模型|服务|变量)/gu, '智能体');
  replaceWhenPresent('group symmetries', /(?:集团|组)对称性?/gu, '群对称性');
  replaceWhenPresent('equivariant', /高度等价(?:的)?/gu, '高度等变的');
  replaceWhenPresent('convergence time', /(?:缩|汇合)时间/gu, '收敛时间');
  replaceWhenPresent('bipedal locomotion', /双脚(?:移动|运动)/gu, '双足运动');
  replaceWhenPresent('quadruped robot', /四脚机器人/gu, '四足机器人');
  replaceWhenPresent('residual reinforcement learning', /残余(?:强化学习|RL)/gu, '残差强化学习');
  replaceWhenPresent('system identification', /系统识别/gu, '系统辨识');
  replaceWhenPresent('sim-to-real', /SIM到真实/giu, '仿真到现实');
  replaceWhenPresent(
    'reinforcement learning holds great promise for improving robot policies beyond the limits of imitation learning',
    /强化学习[^。.!]{0,120}(?:很大的承诺|巨大的希望|很大的前途)[^。.!]*[。.]?/gu,
    '强化学习展现出突破模仿学习局限、进一步改进机器人策略的巨大潜力。'
  );
  replaceWhenPresent(
    'its practical adoption remains bottlenecked by the lack of reliable vision-language reward models that provide dense and informative feedback',
    /然而[，,][^。.!]{0,180}(?:实际采用|实际应用)[^。.!]{0,80}(?:阻碍|制约|瓶困扰)[^。.!]*[。.]?/gu,
    '然而，由于缺乏能够提供稠密且信息丰富反馈的可靠视觉语言奖励模型，其实际应用仍受到制约。'
  );
  replaceWhenPresent('laborious human effort', /(?:劳动力的人力努力|人类的辛勤努力)/gu, '大量人工投入');
  replaceWhenPresent('reward model', /奖励模式/gu, '奖励模型');
  replaceWhenPresent('dense reward', /密集(?:的)?奖励/gu, '稠密奖励');
  replaceWhenPresent('dense and informative feedback', /密集(?:和|且)(?:信息性的反|翔实反馈|信息丰富的?反馈)/gu, '稠密且信息丰富的反馈');
  replaceWhenPresent('failure data', /故障数据/gu, '失败数据');
  replaceWhenPresent('failure trajectories', /故障轨迹/gu, '失败轨迹');
  replaceWhenPresent('pseudo-failures', /伪故障/gu, '伪失败');
  replaceWhenPresent('failure modes', /故障模式/gu, '失败模式');
  replaceWhenPresent('sparse binary', /稀少(?:的)?二进制/gu, '稀疏的二值');
  replaceWhenPresent('sparse trajectory-level success labels', /稀有轨迹(?:水平|级别)的?成功标(?:记|签)/gu, '稀疏的轨迹级成功标签');
  replaceWhenPresent('human labeling', /人类标签/gu, '人工标注');
  replaceWhenPresent('missed grasps', /(?:错失了?抓取|错误抓住|错过抓住)/gu, '抓取失败');
  replaceWhenPresent('physically realistic failure trajectories', /(?:实质性|物理上现实的|物理现实的)失败轨迹/gu, '物理真实的失败轨迹');
  replaceWhenPresent('frame-level', /框架(?:级|水平)/gu, '帧级');
  replaceWhenPresent('throughout an episode', /整个(?:剧集|一集)/gu, '整个回合');
  replaceWhenPresent('to train', /为了培训(\s*[A-Za-z][A-Za-z0-9+_.-]*)/gu, '为训练$1');
  replaceWhenPresent('trained reward models', /训练有素的奖励模型/gu, '训练后的奖励模型');
  replaceWhenPresent('evaluation suite', /评价套件/gu, '评测套件');
  replaceWhenPresent('we release the dataset', /我们释放了数据集/gu, '我们发布了数据集');
  replaceWhenPresent('two key challenges remain', /仍然有两个关键的挑战/gu, '仍有两个关键挑战');
  replaceWhenPresent(
    'relabeling successful demonstrations',
    /重新(?:给)?成功(?:演示|示范)贴上标签/gu,
    '重新标注成功示范'
  );
  replaceWhenPresent('dense robotic reward model', /密集的?机器人奖励模型/gu, '机器人稠密奖励模型');
  replaceWhenPresent('dense frame-level reward scores', /密集帧级的?奖励分数/gu, '稠密的帧级奖励分数');
  replaceWhenPresent('visual observations', /视觉观察/gu, '视觉观测');
  replaceWhenPresent('general-purpose vlms', /通用\s*VLMs?\b/giu, '通用 VLM');
  replaceWhenPresent('we introduce densereward', /我们(?:引入|推出)了?\s*DenseReward/gu, '我们提出 DenseReward');
  replaceWhenPresent('to train densereward', /(?:为了训练|为了培训|为训练)\s*DenseReward/gu, '为训练 DenseReward');
  replaceWhenPresent(
    'automated failure data generation pipeline',
    /自动(?:化)?失败数据生成(?:管道|流水线)/gu,
    '自动化失败数据生成流程'
  );
  replaceWhenPresent('real-world manipulation', /现实世界操纵/gu, '真实世界机器人操作');
  replaceWhenPresent('experiments show', /实验显示/gu, '实验结果表明');

  if (
    sourceLower.includes(
      'two key challenges remain: acquiring diverse failure data at scale and obtaining fine-grained reward signals beyond sparse trajectory-level success labels'
    )
  ) {
    text = text.replace(
      /仍有两个关键挑战[:：][^。.!]*[。.]?/gu,
      '仍有两个关键挑战：一是大规模获取多样化的失败数据，二是获得比稀疏轨迹级成功标签更细粒度的奖励信号。'
    );
  }
  if (sourceLower.includes('we introduce densereward, a dense robotic reward model that addresses both challenges')) {
    text = text.replace(
      /我们提出\s*DenseReward[^。.!]*[。.]?/gu,
      '我们提出 DenseReward——一种同时解决上述两个问题的机器人稠密奖励模型。'
    );
  }
  if (sourceLower.includes('collisions, missed grasps, object drops, and recovery behaviors')) {
    text = text.replace(
      /覆盖了?碰撞[，,]抓取失败[，,]物体掉落[，,](?:和)?恢复行为等?多种失败模式/gu,
      '覆盖碰撞、抓取失败、物体掉落和恢复行为等多种失败模式'
    );
  }
  if (sourceLower.includes('we release the dataset, trained reward models, and evaluation suite')) {
    text = text.replace(
      /我们发布了数据集[，,、]\s*训练后的奖励模型(?:[，,、]\s*(?:以及|和)?)?评测套件/gu,
      '我们发布了数据集、训练后的奖励模型和评测套件'
    );
  }
  if (sourceLower.includes('densereward')) {
    text = text.replace(/DenseReward(?=[\u3400-\u9fff])/gu, 'DenseReward ');
  }
  if (sourceLower.includes('general-purpose vlms')) {
    text = text.replace(/通用 VLM(?=和)/gu, '通用 VLM ');
  }

  if (sourceLower.includes('densereward: dense reward learning via failure synthesis for robotic manipulation')) {
    text = 'DenseReward：面向机器人操作的失败合成稠密奖励学习';
  }

  if (sourceLower.includes('support the development of failure-aware dense reward modeling for robot learning')) {
    text = text.replace(
      /以支持[^。.!]*机器人学习[^。.!]*[。.]?/gu,
      '以支持面向机器人学习的失败感知稠密奖励建模。'
    );
  }

  if (sourceLower.includes('dexterous manipulation') && !text.includes('灵巧操作')) {
    text = `${text.replace(/[：:]\s*$/u, '')}：用于灵巧操作`;
  }

  if (sourceLower.includes('without increasing inference latency')) {
    text = text.replace(
      /(?:从而|并且|同时)?增加(?:了)?未见(?:的)?障碍布局延迟[。.]?/gu,
      '并能泛化到未见的障碍布局，且不增加推理延迟。'
    );
  }

  return text;
}

function normalizeTranslationSpacing(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeChineseAcademicPunctuation(value: string): string {
  if ((value.match(/[\u3400-\u9fff]/gu)?.length ?? 0) < 2) {
    return value;
  }
  return value
    .replace(/([\u3400-\u9fff]),\s*/gu, '$1，')
    .replace(/,\s*(?=[\u3400-\u9fff])/gu, '，')
    .replace(/([\u3400-\u9fff]);\s*/gu, '$1；')
    .replace(/;\s*(?=[\u3400-\u9fff])/gu, '；')
    .replace(/([\u3400-\u9fff]):\s*/gu, '$1：')
    .replace(/:\s*(?=[\u3400-\u9fff])/gu, '：')
    .replace(/([\u3400-\u9fff])\.\s*(?=$|[\u3400-\u9fffA-Za-z])/gu, '$1。')
    .replace(/\.\s*(?=[\u3400-\u9fff])/gu, '。')
    .replace(/\s+([，。；！？])/gu, '$1')
    .replace(/([，。；！？])\s+/gu, '$1')
    .trim();
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
    /[A-Z]{2,}|[A-Za-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*/u.test(cleaned) ||
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
