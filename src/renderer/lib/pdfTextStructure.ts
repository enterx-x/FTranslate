import type { TranslationItem } from './translation';

export type ExtractedBlockType = 'heading' | 'paragraph' | 'formula' | 'caption';

export interface PositionedPdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export interface ExtractedPdfBlock extends TranslationItem {
  id: string;
  type: ExtractedBlockType;
  page: number;
  sourceHash: string;
}

interface TextLine<TItem extends PositionedPdfTextItem = PositionedPdfTextItem> {
  text: string;
  x: number;
  y: number;
  height: number;
  items: TItem[];
}

interface PageTextMetrics {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  medianLineHeight: number;
}

const COLUMN_SPLIT_THRESHOLD = 220;
const PARAGRAPH_GAP_THRESHOLD = 24;
const LINE_SEGMENT_GAP_THRESHOLD = 36;

export function buildPdfPageOutline(page: number, items: PositionedPdfTextItem[]): ExtractedPdfBlock[] {
  const rawLines = buildLines(items);
  const metrics = buildPageTextMetrics(rawLines);
  const contentLines = rawLines.filter((line) => shouldKeepLayoutLine(line, metrics));
  const orderedLines = orderLinesForAcademicLayout(contentLines);
  const firstInlineAbstractY =
    orderedLines.find((line) => extractInlineSection(line.text)?.section.toLowerCase() === 'abstract')?.y ?? null;
  const medianLineHeight = median(contentLines.map((line) => line.height)) ?? PARAGRAPH_GAP_THRESHOLD / 2;
  const blocks: ExtractedPdfBlock[] = [];
  let currentParagraph: TextLine[] = [];
  let currentSection = `Page ${page}`;

  function flushParagraph(): void {
    if (currentParagraph.length === 0) {
      return;
    }

    let original = joinParagraphLines(currentParagraph.map((line) => line.text));
    const inlineSection = extractInlineSection(original);
    const section = inlineSection?.section ?? currentSection;
    original = inlineSection?.body ?? original;

    if (
      shouldIncludeBlock('paragraph', original) &&
      !looksLikePageOnePreAbstractFragment(page, currentSection, inlineSection, currentParagraph, firstInlineAbstractY)
    ) {
      blocks.push(createBlock(page, 'paragraph', section, original));
    }
    currentParagraph = [];
  }

  orderedLines.forEach((line) => {
    const type = classifyLine(line.text);

    if (type !== 'paragraph') {
      flushParagraph();
      const original = type === 'heading' ? normalizeSectionHeading(line.text) : line.text.trim();
      const block = createBlock(page, type, type === 'heading' ? original : currentSection, original);
      const includeBlock = shouldIncludeBlock(type, block.original);
      if (includeBlock) {
        blocks.push(block);
      }
      if (type === 'heading' && includeBlock) {
        currentSection = original;
      }
      return;
    }

    if (shouldSkipStandaloneParagraphLine(line.text)) {
      flushParagraph();
      return;
    }

    const previousLine = currentParagraph.at(-1);
    const paragraphGapThreshold = previousLine
      ? Math.max(medianLineHeight * 2.4, previousLine.height * 1.75, line.height * 1.75)
      : PARAGRAPH_GAP_THRESHOLD;

    if (
      previousLine &&
      (Math.abs(line.y - previousLine.y) > paragraphGapThreshold ||
        Math.abs(line.x - previousLine.x) > COLUMN_SPLIT_THRESHOLD / 2 ||
        startsIndentedParagraphAfterSentence(previousLine, line))
    ) {
      flushParagraph();
    }

    currentParagraph.push(line);
  });

  flushParagraph();
  return blocks;
}

export function buildPdfDocumentOutline(pages: Array<{ page: number; items: PositionedPdfTextItem[] }>): ExtractedPdfBlock[] {
  const pageBlocks = pages.flatMap((page) => buildPdfPageOutline(page.page, page.items));
  return mergeDocumentParagraphContinuations(pageBlocks);
}

function mergeDocumentParagraphContinuations(blocks: ExtractedPdfBlock[]): ExtractedPdfBlock[] {
  const merged: ExtractedPdfBlock[] = [];
  let activeSection: string | null = null;

  blocks.forEach((block) => {
    if (block.type === 'heading') {
      activeSection = block.section || block.original;
      merged.push(block);
      return;
    }

    if (block.type !== 'paragraph') {
      merged.push(block);
      return;
    }

    const inheritedSection = isDefaultPageSection(block.section) && activeSection ? activeSection : block.section;
    const paragraphBlock =
      inheritedSection === block.section ? block : createBlock(block.page, block.type, inheritedSection, block.original);
    const previous = merged.at(-1);

    if (previous && shouldMergeAdjacentParagraphs(previous, paragraphBlock)) {
      const mergedOriginal = joinParagraphLines([previous.original, paragraphBlock.original]);
      merged[merged.length - 1] = createBlock(previous.page, 'paragraph', previous.section, mergedOriginal);
      return;
    }

    merged.push(paragraphBlock);
    if (!isDefaultPageSection(paragraphBlock.section)) {
      activeSection = paragraphBlock.section;
    }
  });

  return merged;
}

function shouldMergeAdjacentParagraphs(previous: ExtractedPdfBlock, next: ExtractedPdfBlock): boolean {
  if (previous.type !== 'paragraph' || next.type !== 'paragraph' || previous.section !== next.section) {
    return false;
  }

  if (previous.page === next.page && !isDefaultPageSection(previous.section)) {
    return !endsWithSentenceBoundary(previous.original);
  }

  return next.page === previous.page + 1 && startsWithLowercaseContinuation(next.original);
}

function endsWithSentenceBoundary(text: string): boolean {
  return /[.!?。！？][)"'\]]*$/u.test(text.trim());
}

function startsIndentedParagraphAfterSentence(previousLine: TextLine, nextLine: TextLine): boolean {
  return nextLine.x - previousLine.x > 6 && endsWithSentenceBoundary(previousLine.text);
}

function startsWithLowercaseContinuation(text: string): boolean {
  const firstLetter = text.trim().match(/\p{L}/u)?.[0];
  return Boolean(firstLetter && firstLetter === firstLetter.toLowerCase() && firstLetter !== firstLetter.toUpperCase());
}

function isDefaultPageSection(section: string): boolean {
  return /^Page\s+\d+$/u.test(section);
}

export function orderPositionedTextItemsForReading<TItem extends PositionedPdfTextItem>(
  items: TItem[]
): TItem[] {
  const lines = buildLines(items);
  const metrics = buildPageTextMetrics(lines);
  return orderLinesForAcademicLayout(lines.filter((line) => shouldKeepLayoutLine(line, metrics))).flatMap(
    (line) => line.items
  );
}

function buildLines<TItem extends PositionedPdfTextItem>(items: TItem[]): Array<TextLine<TItem>> {
  const sortedItems = items
    .filter((item) => item.str.trim())
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const lines: TItem[][] = [];

  sortedItems.forEach((item) => {
    const line = lines.find((candidate) => {
      const reference = candidate[0];
      return Math.abs(reference.y - item.y) <= Math.max(4, reference.height * 0.75);
    });

    if (line) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  });

  return lines.flatMap((lineItems) => {
    const orderedItems = lineItems.sort((left, right) => left.x - right.x);
    const segments: TItem[][] = [];

    orderedItems.forEach((item) => {
      const currentSegment = segments.at(-1);
      const previousItem = currentSegment?.at(-1);
      const horizontalGap = previousItem ? item.x - (previousItem.x + previousItem.width) : 0;
      const baselineDrift = previousItem ? Math.abs(previousItem.y - item.y) : 0;
      const currentSegmentWidth =
        currentSegment && previousItem ? previousItem.x + previousItem.width - currentSegment[0].x : 0;
      const likelyDifferentBaselines =
        previousItem &&
        horizontalGap > 8 &&
        baselineDrift > Math.max(2, Math.min(previousItem.height, item.height) * 0.3);
      const likelyDifferentColumns =
        previousItem &&
        horizontalGap > 8 &&
        (currentSegmentWidth > 200 || (currentSegmentWidth > 120 && item.width > 40));

      if (
        !currentSegment ||
        horizontalGap > LINE_SEGMENT_GAP_THRESHOLD ||
        likelyDifferentBaselines ||
        likelyDifferentColumns
      ) {
        segments.push([item]);
      } else {
        currentSegment.push(item);
      }
    });

    return segments.map((segmentItems) => ({
      text: normalizeExtractedText(segmentItems.map((item) => item.str.trim()).join(' ')),
      x: Math.min(...segmentItems.map((item) => item.x)),
      y: segmentItems.reduce((sum, item) => sum + item.y, 0) / segmentItems.length,
      height: Math.max(...segmentItems.map((item) => item.height)),
      items: segmentItems
    }));
  });
}

function orderLinesForAcademicLayout<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>
): Array<TextLine<TItem>> {
  if (lines.length < 2) {
    return lines;
  }

  const minX = Math.min(...lines.map((line) => line.x));
  const maxX = Math.max(...lines.map((line) => line.x));

  if (maxX - minX < COLUMN_SPLIT_THRESHOLD) {
    return [...lines].sort((left, right) => left.y - right.y || left.x - right.x);
  }

  const splitX = (minX + maxX) / 2;
  const leftColumn = lines
    .filter((line) => line.x <= splitX)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const rightColumn = lines
    .filter((line) => line.x > splitX)
    .sort((left, right) => left.y - right.y || left.x - right.x);

  return [...leftColumn, ...rightColumn];
}

function classifyLine(text: string): ExtractedBlockType {
  const normalized = text.trim();

  if (/^(fig\.|figure|table)\s*\d*[:.]/iu.test(normalized)) {
    return 'caption';
  }

  if (isFormulaLike(normalized)) {
    return 'formula';
  }

  if (/^([IVX]+\.\s+)?[A-Z][A-Z0-9 ,:;()/-]{4,}$/u.test(normalized)) {
    return 'heading';
  }

  return 'paragraph';
}

function shouldIncludeBlock(type: ExtractedBlockType, text: string): boolean {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  if (type === 'paragraph') {
    return looksLikeAcademicParagraph(normalized);
  }

  if (type === 'heading') {
    return !/^references$/iu.test(normalized) && looksLikeSectionHeading(normalized);
  }

  if (type === 'caption') {
    return /^((fig\.|figure|table)\s*\d+[:.])/iu.test(normalized);
  }

  return true;
}

function looksLikeAcademicParagraph(text: string): boolean {
  const words = countWords(text);
  const commaCount = (text.match(/,/gu) ?? []).length;
  const sentenceMarks = (text.match(/[.;:!?。！？]/gu) ?? []).length;
  const lowercaseLetters = (text.match(/\p{Ll}/gu) ?? []).length;

  if (words < 4) {
    return false;
  }

  if (commaCount >= 3 && sentenceMarks === 0) {
    return false;
  }

  if (lowercaseLetters < 6) {
    return false;
  }

  if (
    looksLikeReferenceEntry(text) ||
    looksLikeBibliographyText(text) ||
    looksLikeAppendixContributionList(text) ||
    looksLikeFrontMatterTitle(text) ||
    looksLikeAuthorList(text) ||
    looksLikeShortFigureLabel(text) ||
    looksLikeShortEpigraphQuote(text)
  ) {
    return false;
  }

  if (sentenceMarks === 0 && looksLikeDiagramLabelVocabulary(text)) {
    return false;
  }

  if (sentenceMarks === 0 && looksLikeFigureActionLabel(text)) {
    return false;
  }

  if (sentenceMarks > 0) {
    return true;
  }

  return words >= 6;
}

function looksLikePageOnePreAbstractFragment(
  page: number,
  currentSection: string,
  inlineSection: { section: string; body: string } | null,
  lines: TextLine[],
  firstInlineAbstractY: number | null
): boolean {
  if (page !== 1 || inlineSection || currentSection !== 'Page 1' || lines.length === 0 || firstInlineAbstractY === null) {
    return false;
  }

  const firstY = Math.min(...lines.map((line) => line.y));
  return firstY < firstInlineAbstractY;
}

function looksLikeSectionHeading(text: string): boolean {
  const normalized = text.trim();
  return (
    /^(abstract|introduction|related work|method|methods|experiments?|results?|discussion|conclusion|references)s?$/iu.test(
      normalized
    ) || /^([IVX]+|\d+)\.?\s+[A-Z][A-Z0-9 ,:;()/-]{3,}$/u.test(normalized)
  );
}

function normalizeSectionHeading(text: string): string {
  let normalized = text.trim().replace(/\s*-\s*/gu, '-').replace(/\s+/gu, ' ');
  let previous = '';

  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized.replace(/\b([A-Z])\s+(?=[A-Z][A-Z-]*\b)/gu, '$1');
  }

  return normalized;
}

function extractInlineSection(text: string): { section: string; body: string } | null {
  const match = text.match(/^(abstract|introduction|conclusion|references)\s*[-\u2013\u2014]\s*(.+)$/iu);
  if (!match) {
    return null;
  }

  return {
    section: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
    body: match[2].trim()
  };
}

function isFormulaLike(text: string): boolean {
  if (text.length > 120) {
    return false;
  }

  const mathSymbols = (text.match(/[=∑∫√∞≤≥≠≈→+\-*/^_{}[\]()]/gu) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return mathSymbols >= 3 && mathSymbols >= letters * 0.35;
}

function joinParagraphLines(lines: string[]): string {
  const joined = lines.reduce((paragraph, line) => {
    if (!paragraph) {
      return line.trim();
    }

    if (/[-\u00ad\u2010-\u2015]$/u.test(paragraph)) {
      return paragraph.replace(/[-\u00ad\u2010-\u2015]$/u, '') + line.trim();
    }

    return `${paragraph} ${line.trim()}`;
  }, '');
  return normalizeExtractedText(joined);
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\s+/gu, ' ')
    .replace(/([πΠ])\s+(\d)\s*\.\s*(\d)/gu, '$1$2.$3')
    .trim();
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function buildPageTextMetrics(lines: Array<TextLine>): PageTextMetrics {
  if (lines.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      width: 1,
      height: 1,
      medianLineHeight: PARAGRAPH_GAP_THRESHOLD / 2
    };
  }

  const minX = Math.min(...lines.map((line) => line.x));
  const maxX = Math.max(...lines.map((line) => Math.max(...line.items.map((item) => item.x + item.width))));
  const minY = Math.min(...lines.map((line) => line.y));
  const maxY = Math.max(...lines.map((line) => line.y + line.height));

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    medianLineHeight: median(lines.map((line) => line.height)) ?? PARAGRAPH_GAP_THRESHOLD / 2
  };
}

function shouldKeepLayoutLine(line: TextLine, metrics: PageTextMetrics): boolean {
  const normalized = line.text.trim();

  if (!normalized) {
    return false;
  }

  if (isLikelyPageChrome(line, metrics)) {
    return false;
  }

  if (isLikelySidebarLine(line, metrics)) {
    return false;
  }

  return true;
}

function isLikelyPageChrome(line: TextLine, metrics: PageTextMetrics): boolean {
  const normalized = line.text.trim();
  const nearTop = line.y <= metrics.minY + metrics.height * 0.08;
  const nearBottom = line.y >= metrics.maxY - metrics.height * 0.08;

  if (/^\d{1,4}$/u.test(normalized) && (nearTop || nearBottom)) {
    return true;
  }

  if (nearTop || nearBottom) {
    return /^(doi:|https?:\/\/|www\.|[\w.-]+\.pdf$)/iu.test(normalized);
  }

  return false;
}

function isLikelySidebarLine(line: TextLine, metrics: PageTextMetrics): boolean {
  const normalized = line.text.trim();
  const nearLeftEdge = line.x <= metrics.minX + metrics.width * 0.08;
  const veryTall = line.height >= metrics.medianLineHeight * 4;

  return nearLeftEdge && (veryTall || /^arxiv:/iu.test(normalized) || /\[[a-z-]+\.[A-Z]{2}\]/u.test(normalized));
}

function looksLikeFrontMatterTitle(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const titleCaseWords = words.filter((word) => /^\p{Lu}[\p{Ll}\p{L}\p{N}]*$/u.test(word)).length;
  return words.length <= 12 && titleCaseWords >= Math.max(3, Math.floor(words.length * 0.45));
}

function looksLikeAuthorList(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}.]+/gu) ?? [];
  const commaCount = (text.match(/,/gu) ?? []).length;

  if (words.length < 8 || commaCount < 3) {
    return false;
  }

  const nameLikeWords = words.filter((word) => /^(\p{Lu}\.|[\p{Lu}][\p{Ll}]+)$/u.test(word)).length;
  const proseWords = words.filter((word) =>
    /^(the|and|that|this|with|from|for|into|using|used|can|are|is|be|has|have|model|models|data|training|tasks)$/iu.test(
      word
    )
  ).length;

  return nameLikeWords / words.length >= 0.65 && proseWords <= 2;
}

function looksLikeReferenceEntry(text: string): boolean {
  const normalized = text.trim();
  return /^\[\d+\]\s+/u.test(normalized) || /^\d+\.\s+\p{Lu}[\p{L}.-]+,\s+\p{Lu}/u.test(normalized);
}

function looksLikeBibliographyText(text: string): boolean {
  const normalized = text.trim();
  const commaCount = (normalized.match(/,/gu) ?? []).length;
  if (commaCount < 4) {
    return false;
  }

  return /\b(19|20)\d{2}\b/u.test(normalized) || /\b(arxiv|preprint|proceedings|conference|journal|transactions)\b/iu.test(normalized);
}

function looksLikeAppendixContributionList(text: string): boolean {
  const normalized = text.toLowerCase();
  const commaCount = (text.match(/,/gu) ?? []).length;
  const contributionHeadings = [
    'data collection and operations',
    'annotation and supplemental data',
    'policy training and research',
    'policy infrastructure',
    'robot hardware',
    'robot infrastructure',
    'writing and illustration'
  ].filter((heading) => normalized.includes(heading)).length;

  return commaCount >= 4 && contributionHeadings >= 1;
}

function looksLikeShortFigureLabel(text: string): boolean {
  const normalized = text.trim();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const sentenceMarks = (normalized.match(/[.;:!?。！？]/gu) ?? []).length;

  if (sentenceMarks > 0 || words.length > 8) {
    return false;
  }

  const titleCaseWords = words.filter((word) => /^\p{Lu}[\p{Ll}\p{L}\p{N}]*$/u.test(word)).length;
  const labelVocabulary = words.filter((word) =>
    /^(data|model|prompt|metadata|subgoal|image|images|episode|policy|expert|instruction|instructions|robot|world|action)$/iu.test(
      word
    )
  ).length;

  return titleCaseWords >= 2 || labelVocabulary >= 2;
}

function looksLikeShortEpigraphQuote(text: string): boolean {
  const normalized = text.trim();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const academicWords = words.filter((word) =>
    /^(model|models|data|training|learning|robot|robots|policy|method|experiment|performance|capabilities)$/iu.test(word)
  ).length;

  return words.length <= 14 && /^I\s+(am|have|was|will|shall|can|could|would|should)\b/u.test(normalized) && academicWords === 0;
}

function shouldSkipStandaloneParagraphLine(text: string): boolean {
  return looksLikeShortEpigraphQuote(text) || looksLikeEpigraphAttribution(text);
}

function looksLikeEpigraphAttribution(text: string): boolean {
  const normalized = text.trim();
  const words = normalized.match(/[\p{L}\p{N}.]+/gu) ?? [];
  const commaCount = (normalized.match(/,/gu) ?? []).length;

  if (words.length < 3 || words.length > 8 || commaCount < 2) {
    return false;
  }

  const nameLikeWords = words.filter((word) => /^(\p{Lu}\.|[\p{Lu}][\p{Ll}]+)$/u.test(word)).length;
  return nameLikeWords >= words.length - 1;
}

function looksLikeDiagramLabelVocabulary(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) {
    return false;
  }

  const labelVocabulary = words.filter((word) =>
    /^(autonomous|data|demonstration|model|prompt|metadata|subgoal|image|images|episode|policy|expert|instruction|instructions|robot|world|action|multimodal)$/iu.test(
      word
    )
  ).length;

  return labelVocabulary >= 3 && labelVocabulary / words.length >= 0.2;
}

function looksLikeFigureActionLabel(text: string): boolean {
  const normalized = text.toLowerCase();
  if (
    /^(demonstration data|autonomous data|robot data|non-robot data|multimodal web data|egocentric human data)\b/u.test(
      normalized
    )
  ) {
    return true;
  }

  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const actionWords = words.filter((word) =>
    /^(open|close|pick|put|load|throw|fold|move|place|take|chop|pour|wipe|turn|press|push|pull)$/iu.test(word)
  ).length;

  return words.length >= 10 && actionWords >= 3;
}

function createBlock(
  page: number,
  type: ExtractedBlockType,
  section: string,
  original: string
): ExtractedPdfBlock {
  const sourceHash = hashText(`${page}|${type}|${section}|${original}`);

  return {
    id: `pdf-${page}-${sourceHash}`,
    section,
    original,
    translation: '',
    type,
    page,
    sourceHash
  };
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
