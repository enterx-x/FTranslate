import type { TranslationItem } from './translation';

export type ExtractedBlockType = 'heading' | 'paragraph' | 'formula' | 'caption';

export interface PositionedPdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  pageWidth?: number;
  pageHeight?: number;
}

export interface PdfBlockBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth?: number;
  pageHeight?: number;
}

export interface ExtractedPdfBlock extends TranslationItem {
  id: string;
  type: ExtractedBlockType;
  page: number;
  sourceHash: string;
  bounds?: PdfBlockBounds;
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

    if (inlineSection) {
      currentSection = inlineSection.section;
    }

    if (
      shouldIncludeBlock('paragraph', original) &&
      !looksLikePageOnePreAbstractFragment(page, currentSection, inlineSection, currentParagraph, firstInlineAbstractY)
    ) {
      blocks.push(createBlock(page, 'paragraph', section, original, getLinesBounds(currentParagraph)));
    }
    currentParagraph = [];
  }

  orderedLines.forEach((line) => {
    const type = classifyLine(line.text);

    if (type !== 'paragraph') {
      flushParagraph();
      if (page === 1 && firstInlineAbstractY !== null && line.y < firstInlineAbstractY - 4) {
        return;
      }
      const original = type === 'heading' ? normalizeSectionHeading(line.text) : line.text.trim();
      const block = createBlock(page, type, type === 'heading' ? original : currentSection, original, getLinesBounds([line]));
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

    const previousLine = currentParagraph[currentParagraph.length - 1];
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

/**
 * Lossless outline for the phone reader. The analysis outline intentionally
 * drops front matter and references; a reader must preserve them. Text proven
 * to live inside a figure/table is removed later by the geometric mobile pass.
 */
export function buildPdfReaderPageOutline(page: number, items: PositionedPdfTextItem[]): ExtractedPdfBlock[] {
  const rawLines = restoreReaderDropCaps(
    buildLines(items.filter((item) => !isPositionedPageSidebarItem(item)))
  );
  const metrics = buildPageTextMetrics(rawLines);
  const contentLines = rawLines.filter((line) => shouldKeepLayoutLine(line, metrics));
  const medianLineHeight = median(contentLines.map((line) => line.height)) ?? PARAGRAPH_GAP_THRESHOLD / 2;
  const medianLineStep = estimateReaderLineStep(contentLines) ?? medianLineHeight * 1.35;
  const captionMergedLines = mergeBareIeeeTableCaptionLines(contentLines, metrics);
  const orderedLines = mergeWrappedReaderHeadingLines(
    orderLinesForReaderLayout(captionMergedLines, page, metrics),
    page,
    metrics,
    medianLineHeight
  );
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
    if (inlineSection) {
      currentSection = inlineSection.section;
    }
    splitReaderParagraphText(original).forEach((paragraph) => {
      if (containsReadableText(paragraph)) {
        blocks.push(createBlock(page, 'paragraph', section, paragraph, getLinesBounds(currentParagraph)));
      }
    });
    currentParagraph = [];
  }

  orderedLines.forEach((line, index) => {
    const type = classifyReaderLine(line, page, metrics, medianLineHeight, orderedLines[index - 1]);
    if (type !== 'paragraph') {
      flushParagraph();
      const original = type === 'heading'
        ? normalizeSectionHeading(line.text)
        : type === 'caption'
          ? normalizeReaderCaption(line.text)
          : line.text.trim();
      if (!containsReadableText(original)) {
        return;
      }
      blocks.push(createBlock(
        page,
        type,
        type === 'heading' ? original : currentSection,
        original,
        getLinesBounds([line])
      ));
      if (type === 'heading') {
        currentSection = original;
      }
      return;
    }

    const previousLine = currentParagraph[currentParagraph.length - 1];
    const lineIsAffiliation = page === 1 && looksLikeReaderAffiliation(line.text);
    const previousIsAffiliation = page === 1 && Boolean(previousLine) && looksLikeReaderAffiliation(previousLine.text);
    const paragraphGapThreshold = previousLine
      ? Math.max(medianLineStep * 1.3, previousLine.height * 1.45, line.height * 1.45)
      : PARAGRAPH_GAP_THRESHOLD;
    if (
      previousLine &&
      (lineIsAffiliation !== previousIsAffiliation ||
        Math.abs(line.y - previousLine.y) > paragraphGapThreshold ||
        Math.abs(line.x - previousLine.x) > COLUMN_SPLIT_THRESHOLD / 2 ||
        hasSignificantReaderFontChange(previousLine, line) ||
        startsNewReaderParagraph(currentParagraph, line))
    ) {
      flushParagraph();
    }
    currentParagraph.push(line);
  });

  flushParagraph();
  return mergeReaderBlockContinuations(blocks);
}

function orderLinesForReaderLayout<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>,
  page: number,
  metrics: PageTextMetrics
): Array<TextLine<TItem>> {
  if (page !== 1) {
    const topCenteredTableCaptions = lines.filter((line) => (
      /^TABLE\s+[IVXLCDM\d]+(?:\s+|$)/u.test(line.text.trim()) &&
      line.y <= metrics.minY + metrics.height * 0.18 &&
      Math.abs(getLineCenterX(line) - (metrics.minX + metrics.width / 2)) <= Math.max(55, metrics.width * 0.14)
    ));
    const remainingLines = lines.filter((line) => !topCenteredTableCaptions.includes(line));
    return [
      ...topCenteredTableCaptions.sort((left, right) => left.y - right.y || left.x - right.x),
      ...orderLinesForAcademicLayout(remainingLines)
    ];
  }
  const frontMatterLimit = metrics.minY + metrics.height * 0.18;
  const pageCenter = metrics.minX + metrics.width / 2;
  const frontMatter = lines
    .filter((line) => (
      line.y <= frontMatterLimit &&
      Math.abs(getLineCenterX(line) - pageCenter) <= Math.max(55, metrics.width * 0.16)
    ))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const body = lines.filter((line) => !frontMatter.includes(line));
  return [...frontMatter, ...orderLinesForAcademicLayout(body)];
}

function hasSignificantReaderFontChange(previous: TextLine, next: TextLine): boolean {
  const smaller = Math.min(previous.height, next.height);
  const larger = Math.max(previous.height, next.height);
  return smaller / Math.max(1, larger) < 0.78 && Math.abs(next.y - previous.y) > smaller * 1.2;
}

function mergeReaderBlockContinuations(blocks: ExtractedPdfBlock[]): ExtractedPdfBlock[] {
  const merged: ExtractedPdfBlock[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    const forcedHyphenContinuation = previous &&
      previous.page === block.page &&
      /[-\u00ad\u2010-\u2015]$/u.test(previous.original.trim()) &&
      startsWithLowercaseContinuation(block.original);
    const decimalSentenceContinuation = previous?.type === 'paragraph' &&
      block.type === 'heading' &&
      previous.page === block.page &&
      !endsWithSentenceBoundary(previous.original) &&
      /^\d+\.\d+\.\s+\p{Lu}/u.test(block.original.trim());
    const mergeCaption = previous?.type === 'caption' && block.type === 'paragraph' &&
      !endsWithSentenceBoundary(previous.original) &&
      areReaderBlocksVerticallyAdjacent(previous, block) &&
      (!/^table\b/iu.test(previous.original.trim()) || countWords(block.original) <= 10) &&
      (
        /[-\u00ad\u2010-\u2015]$/u.test(previous.original.trim()) ||
        startsWithLowercaseContinuation(block.original) ||
        (/^table\b/iu.test(previous.original.trim()) && /[:(]\s*$/u.test(previous.original.trim())) ||
        /\b(?:and|or|of|for|with|to|in|on|between)\s*$/iu.test(previous.original.trim())
      );
    const mergeParagraph = previous?.type === 'paragraph' && block.type === 'paragraph' &&
      previous.section === block.section &&
      !looksLikeReaderAffiliation(previous.original) &&
      !looksLikeReaderAffiliation(block.original) &&
      !/^\d+\)\s+\p{Lu}[^:]{2,100}:\s+\p{Lu}/u.test(block.original) &&
      !endsWithSentenceBoundary(previous.original) &&
      (areReaderParagraphBlocksContiguous(previous, block) || isLikelyReaderProseContinuation(previous, block));
    const mergeHeading = previous?.type === 'heading' && block.type === 'paragraph' &&
      /[-\u00ad\u2010-\u2015]$/u.test(previous.original.trim()) &&
      countWords(block.original) <= 16;
    if (previous && (forcedHyphenContinuation || decimalSentenceContinuation || mergeCaption || mergeParagraph || mergeHeading)) {
      const mergedType = decimalSentenceContinuation
        ? 'paragraph'
        : forcedHyphenContinuation && previous.type !== 'caption' && previous.type !== 'heading'
          ? (previous.type === 'paragraph' || block.type === 'paragraph' ? 'paragraph' : previous.type)
          : previous.type;
      merged[merged.length - 1] = createBlock(
        previous.page,
        mergedType,
        previous.section,
        joinParagraphLines([previous.original, block.original]),
        mergeBounds(previous.bounds, block.bounds)
      );
      continue;
    }
    merged.push(block);
  }
  return merged;
}

function isLikelyReaderProseContinuation(previous: ExtractedPdfBlock, next: ExtractedPdfBlock): boolean {
  const previousText = previous.original.trim();
  return startsWithLowercaseContinuation(next.original) ||
    /[-\u00ad\u2010-\u2015]$/u.test(previousText) ||
    /\b(?:fig|eq|sec)\.$/iu.test(previousText) ||
    /\b(?:a|an|and|as|at|between|by|for|from|in|of|on|or|the|to|with)\s*$/iu.test(previousText);
}

function areReaderBlocksVerticallyAdjacent(previous: ExtractedPdfBlock, next: ExtractedPdfBlock): boolean {
  if (!previous.bounds || !next.bounds) {
    return true;
  }
  const gap = next.bounds.y - (previous.bounds.y + previous.bounds.height);
  return gap >= -4 && gap <= Math.max(18, previous.bounds.height * 1.8, next.bounds.height * 1.8);
}

function areReaderParagraphBlocksContiguous(previous: ExtractedPdfBlock, next: ExtractedPdfBlock): boolean {
  if (!previous.bounds || !next.bounds || previous.page !== next.page) {
    return true;
  }
  const verticalGap = next.bounds.y - (previous.bounds.y + previous.bounds.height);
  if (verticalGap >= -4 && verticalGap <= 20) {
    return true;
  }
  const pageWidth = previous.bounds.pageWidth ?? next.bounds.pageWidth ?? 0;
  const pageHeight = previous.bounds.pageHeight ?? next.bounds.pageHeight ?? 0;
  const previousBottom = previous.bounds.y + previous.bounds.height;
  return pageWidth > 0 && pageHeight > 0 &&
    previous.bounds.x + previous.bounds.width / 2 < pageWidth / 2 &&
    next.bounds.x + next.bounds.width / 2 > pageWidth / 2 &&
    previousBottom > pageHeight * 0.68 &&
    next.bounds.y < previousBottom - Math.max(8, next.bounds.height * 0.5);
}

function isPositionedPageSidebarItem(item: PositionedPdfTextItem): boolean {
  const pageWidth = item.pageWidth ?? 0;
  return /^arxiv:/iu.test(item.str.trim()) && pageWidth > 0 && item.x <= pageWidth * 0.1;
}

function restoreReaderDropCaps<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>
): Array<TextLine<TItem>> {
  const medianItemHeight = median(lines.flatMap((line) => line.items.map((item) => item.height))) ?? 0;
  if (medianItemHeight <= 0) {
    return lines;
  }
  const restored = lines.map((line) => ({ ...line, items: [...line.items] }));
  for (let index = 0; index < restored.length; index += 1) {
    const line = restored[index];
    const cap = line.items.find((candidate) => (
      /^\p{Lu}$/u.test(candidate.str.trim()) &&
      candidate.height >= medianItemHeight * 1.55
    ));
    if (!cap) {
      continue;
    }
    const remainingItems = line.items.filter((item) => item !== cap);
    if (remainingItems.length === 0 || cap.x >= Math.min(...remainingItems.map((item) => item.x)) - 2) {
      continue;
    }
    const remainingX = Math.min(...remainingItems.map((item) => item.x));
    const previous = restored
      .filter((candidate, candidateIndex) => (
        candidateIndex !== index &&
        candidate.y < line.y &&
        line.y - candidate.y <= Math.max(cap.height * 1.25, medianItemHeight * 3) &&
        Math.abs(remainingX - candidate.x) <= 36 &&
        /^\p{Lu}{1,16}\b/u.test(candidate.text.trim())
      ))
      .sort((left, right) => Math.abs(line.y - left.y) - Math.abs(line.y - right.y))[0];
    if (!previous) {
      continue;
    }
    previous.text = `${cap.str.trim()}${previous.text.trimStart()}`;
    previous.x = Math.min(previous.x, cap.x);
    previous.items = [cap, ...previous.items];
    line.items = remainingItems;
    line.text = normalizeExtractedText(
      [...remainingItems].sort((left, right) => left.x - right.x).map((item) => item.str).join(' ')
    );
    line.x = Math.min(...remainingItems.map((item) => item.x));
    line.height = Math.max(...remainingItems.map((item) => item.height));
  }
  return restored.filter((line) => containsReadableText(line.text));
}

export function buildPdfDocumentOutline(pages: Array<{ page: number; items: PositionedPdfTextItem[] }>): ExtractedPdfBlock[] {
  const pageBlocks = pages.flatMap((page) => buildPdfPageOutline(page.page, page.items));
  return addSectionGroupingMetadata(mergeDocumentParagraphContinuations(pageBlocks));
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
      inheritedSection === block.section ? block : createBlock(block.page, block.type, inheritedSection, block.original, block.bounds);
    const previous = merged[merged.length - 1];

    if (previous && shouldMergeAdjacentParagraphs(previous, paragraphBlock)) {
      const mergedOriginal = joinParagraphLines([previous.original, paragraphBlock.original]);
      merged[merged.length - 1] = createBlock(
        previous.page,
        'paragraph',
        previous.section,
        mergedOriginal,
        mergeBounds(previous.bounds, paragraphBlock.bounds)
      );
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

function addSectionGroupingMetadata(blocks: ExtractedPdfBlock[]): ExtractedPdfBlock[] {
  const sectionMap = new Map<string, { id: string; order: number; paragraphOrder: number }>();

  function getSection(section: string): { id: string; order: number; paragraphOrder: number } {
    const normalizedSection = section.trim() || 'Untitled';
    const existing = sectionMap.get(normalizedSection);

    if (existing) {
      return existing;
    }

    const order = sectionMap.size + 1;
    const entry = {
      id: `section-${order}-${hashText(normalizedSection)}`,
      order,
      paragraphOrder: 0
    };
    sectionMap.set(normalizedSection, entry);
    return entry;
  }

  return blocks.map((block) => {
    const section = getSection(block.section || block.original || 'Untitled');
    const paragraphOrder = block.type === 'paragraph' ? (section.paragraphOrder += 1) : undefined;

    return {
      ...block,
      sectionId: section.id,
      sectionOrder: section.order,
      paragraphOrder
    };
  });
}

function endsWithSentenceBoundary(text: string): boolean {
  const normalized = text.trim();
  if (/\b(?:fig|eq|sec|dr|prof)\.[)"'\]]*$/iu.test(normalized)) {
    return false;
  }
  return /[.!?。！？][)"'\]]*$/u.test(normalized);
}

function startsIndentedParagraphAfterSentence(previousLine: TextLine, nextLine: TextLine): boolean {
  return nextLine.x - previousLine.x > 6 && endsWithSentenceBoundary(previousLine.text);
}

function startsNewReaderParagraph(currentParagraph: TextLine[], nextLine: TextLine): boolean {
  const previousLine = currentParagraph[currentParagraph.length - 1];
  if (!previousLine) {
    return false;
  }
  const nextText = nextLine.text.trim();
  if (
    endsWithSentenceBoundary(previousLine.text) &&
    (/^\[\d{1,4}\]\s/u.test(nextText) || /^(?:[•●▪◦]|\(?[a-z]\)|\d+[.)])\s+/iu.test(nextText))
  ) {
    return true;
  }
  if (looksLikeRunInAcademicHeadingStart(nextText)) {
    return true;
  }
  const paragraphLeft = Math.min(...currentParagraph.map((line) => line.x));
  return nextLine.x - paragraphLeft > 6 && endsWithSentenceBoundary(previousLine.text);
}

function looksLikeRunInAcademicHeadingStart(text: string): boolean {
  if (/^\d+\)\s+\p{Lu}[^:]{2,100}:\s+\p{Lu}/u.test(text)) {
    return true;
  }
  const match = text.match(/^([^.!?]{2,72}\.)\s+(.+)$/u);
  if (!match || countWords(match[2]) < 5) {
    return false;
  }
  const words = match[1].slice(0, -1).trim().split(/\s+/u);
  if (words.length === 0 || words.length > 8) {
    return false;
  }
  if (/^(?:fig|eq|sec|table|dr|prof)\.?$/iu.test(words[0])) {
    return false;
  }
  const lowercaseConnectors = new Set(['a', 'an', 'and', 'as', 'at', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  const titleCasePhrase = words.every((word) => {
    const cleaned = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}/-]+$/gu, '');
    if (!cleaned) {
      return true;
    }
    if (lowercaseConnectors.has(cleaned.toLowerCase())) {
      return cleaned === cleaned.toLowerCase();
    }
    return cleaned.split(/[/-]/u).every((part) => !part || /^\p{Lu}/u.test(part) || /^[A-Z\d]+$/u.test(part));
  });
  if (titleCasePhrase && words.length >= 2) {
    return true;
  }
  const normalizedWords = words.map((word) => word.replace(/[^\p{L}]/gu, '').toLowerCase()).filter(Boolean);
  const headingNouns = new Set([
    'analysis', 'architecture', 'baselines', 'decomposition', 'details', 'encoder', 'evaluation',
    'experts', 'loss', 'metrics', 'objective', 'objectives', 'policy', 'protocol', 'results',
    'setup', 'tokenizers', 'training', 'trunk'
  ]);
  const sentenceSignals = new Set(['are', 'build', 'develop', 'has', 'have', 'is', 'provide', 'provides', 'show', 'shows', 'this', 'these', 'use', 'uses', 'was', 'we', 'were']);
  return normalizedWords.length <= 4 &&
    normalizedWords.some((word) => headingNouns.has(word)) &&
    !normalizedWords.some((word) => sentenceSignals.has(word));
}

function splitReaderParagraphText(text: string): string[] {
  const headingBoundaries = [...text.matchAll(/[.!?。！？][)"'\]]*\s+/gu)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => index > 0 && looksLikeRunInAcademicHeadingStart(text.slice(index)));
  const numberedRunInBoundaries = [...text.matchAll(/\s+(?=\d+\)\s+\p{Lu}[^:]{2,100}:\s+\p{Lu})/gu)]
    .map((match) => (match.index ?? 0) + match[0].length);
  const referenceMatches = [...text.matchAll(/(?:^|\s)(?=\d{1,3}\.\s+\p{Lu}[\p{L}'-]+,\s*\p{Lu}\.)/gu)];
  const referenceBoundaries = referenceMatches.length >= 2
    ? referenceMatches.map((match) => (match.index ?? 0) + match[0].length)
    : [];
  const boundaries = Array.from(new Set([
    ...headingBoundaries,
    ...numberedRunInBoundaries,
    ...referenceBoundaries
  ])).filter((index) => index > 0).sort((left, right) => left - right);
  if (boundaries.length === 0) {
    return [text];
  }
  const paragraphs: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    paragraphs.push(text.slice(start, boundary).trim());
    start = boundary;
  }
  paragraphs.push(text.slice(start).trim());
  return paragraphs.filter(Boolean);
}

function startsWithLowercaseContinuation(text: string): boolean {
  const firstLetter = text.trim().match(/\p{L}/u)?.[0];
  return Boolean(firstLetter && firstLetter === firstLetter.toLowerCase() && firstLetter !== firstLetter.toUpperCase());
}

function estimateReaderLineStep(lines: TextLine[]): number | null {
  const steps: number[] = [];
  for (const line of lines) {
    const nextGap = lines
      .filter((candidate) => (
        candidate.y > line.y &&
        Math.abs(candidate.x - line.x) <= 42
      ))
      .map((candidate) => candidate.y - line.y)
      .filter((gap) => gap >= Math.max(3, line.height * 0.65) && gap <= Math.max(42, line.height * 3.5))
      .sort((left, right) => left - right)[0];
    if (Number.isFinite(nextGap)) {
      steps.push(nextGap);
    }
  }
  return median(steps);
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
      const currentSegment = segments[segments.length - 1];
      const previousItem = currentSegment?.[currentSegment.length - 1];
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

function mergeWrappedReaderHeadingLines<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>,
  page: number,
  metrics: PageTextMetrics,
  medianLineHeight: number
): Array<TextLine<TItem>> {
  const merged: Array<TextLine<TItem>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    let current = lines[index];
    let next = lines[index + 1];
    while (next && shouldMergeReaderHeadingLines(current, next, page, metrics, medianLineHeight)) {
      const combinedItems = [...current.items, ...next.items];
      current = {
        text: normalizeExtractedText(`${current.text} ${next.text}`),
        x: Math.min(current.x, next.x),
        y: Math.min(current.y, next.y),
        height: Math.max(current.height, next.height),
        items: combinedItems
      };
      index += 1;
      next = lines[index + 1];
    }
    merged.push(current);
  }
  return merged;
}

function mergeBareIeeeTableCaptionLines<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>,
  metrics: PageTextMetrics
): Array<TextLine<TItem>> {
  const consumed = new Set<number>();
  const merged: Array<TextLine<TItem>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (consumed.has(index)) {
      continue;
    }
    const line = lines[index];
    const normalizedLine = line.text.trim();
    const bareTableLabel = /^TABLE\s+[IVXLCDM\d]+$/u.test(normalizedLine);
    const unclosedParenthesis = /^TABLE\s+[IVXLCDM\d]+\s*[:.]/u.test(normalizedLine) &&
      (normalizedLine.match(/\(/gu) ?? []).length > (normalizedLine.match(/\)/gu) ?? []).length;
    if (!bareTableLabel && !unclosedParenthesis) {
      merged.push(line);
      continue;
    }
    const continuationIndex = lines.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === index || consumed.has(candidateIndex)) {
        return false;
      }
      const verticalGap = candidate.y - line.y;
      const centersAligned = Math.abs(getLineCenterX(line) - getLineCenterX(candidate)) <= Math.max(45, metrics.width * 0.12);
      const letters = candidate.text.match(/\p{L}/gu) ?? [];
      const uppercaseLetters = candidate.text.match(/\p{Lu}/gu) ?? [];
      const leftAligned = Math.abs(line.x - candidate.x) <= 24;
      const wordCount = countWords(candidate.text);
      return verticalGap > 0 &&
        verticalGap <= Math.max(24, line.height * 2.5, candidate.height * 2.5) &&
        (
          (bareTableLabel && centersAligned && wordCount >= 2 && wordCount <= 18 && letters.length >= 6 && uppercaseLetters.length / letters.length >= 0.72) ||
          (unclosedParenthesis && (leftAligned || centersAligned) && wordCount >= 1 && wordCount <= 4 && /\)/u.test(candidate.text))
        );
    });
    if (continuationIndex < 0) {
      merged.push(line);
      continue;
    }
    const continuation = lines[continuationIndex];
    consumed.add(continuationIndex);
    merged.push({
      text: normalizeExtractedText(`${line.text} ${continuation.text}`),
      x: Math.min(line.x, continuation.x),
      y: Math.min(line.y, continuation.y),
      height: Math.max(line.height, continuation.height),
      items: [...line.items, ...continuation.items]
    });
  }
  return merged;
}

function shouldMergeReaderHeadingLines(
  current: TextLine,
  next: TextLine,
  page: number,
  metrics: PageTextMetrics,
  medianLineHeight: number
): boolean {
  const verticalGap = next.y - current.y;
  if (verticalGap <= 0 || verticalGap > Math.max(current.height * 1.9, next.height * 1.9, medianLineHeight * 3)) {
    return false;
  }
  const centersAligned = Math.abs(getLineCenterX(current) - getLineCenterX(next)) <= Math.max(45, metrics.width * 0.12);
  const leftAligned = Math.abs(current.x - next.x) <= 24;
  const frontMatterWrap = page === 1 &&
    centersAligned &&
    isReaderFrontMatterHeading(current, metrics, medianLineHeight) &&
    isReaderFrontMatterHeading(next, metrics, medianLineHeight);
  if (frontMatterWrap) {
    return true;
  }

  const numberedHeading = /^([IVX]+|\d+(?:\.\d+)*|[A-Z])\.\s+/u.test(current.text.trim());
  const nextWords = countWords(next.text);
  const connectiveWrap = /\b(and|for|of|on|to|with|without|in|under|from)\s*$/iu.test(current.text) ||
    /^(and|for|of|on|to|with|without|in|under|from)\b/iu.test(next.text.trim());
  const uppercaseContinuation = /^[\p{Lu}\p{N}][\p{Lu}\p{N} ,:;()/-]{2,}$/u.test(next.text.trim());
  const bareIeeeTableLabel = /^TABLE\s+[IVXLCDM\d]+$/u.test(current.text.trim());
  return (
    bareIeeeTableLabel && centersAligned && nextWords <= 15
  ) || (
    numberedHeading && nextWords <= 6 && (
      (leftAligned && connectiveWrap) ||
      (centersAligned && uppercaseContinuation)
    )
  );
}

function classifyReaderLine(
  line: TextLine,
  page: number,
  metrics: PageTextMetrics,
  medianLineHeight: number,
  previousLine?: TextLine
): ExtractedBlockType {
  const normalized = line.text.trim();
  if (
    (
      /^(fig\.?|figure|table)\s*[\divxlcdm]*[:.]/iu.test(normalized) ||
      /^algorithm\s+\d+\b/iu.test(normalized) ||
      /^TABLE\s+[IVXLCDM\d]+(?:\s+|$)/u.test(normalized)
    ) &&
    !looksLikeInlineFigureReferenceContinuation(previousLine, line)
  ) {
    return 'caption';
  }
  if (page === 1 && looksLikeReaderAffiliation(normalized)) {
    return 'paragraph';
  }
  if (isFormulaLike(normalized)) {
    return 'formula';
  }
  if (
    /^([IVX]+\.\s+)?[A-Z][A-Z0-9 ,:;()/-]{4,}$/u.test(normalized) ||
    looksLikeSectionHeading(normalizeSectionHeading(normalized)) ||
    (page === 1 && isReaderFrontMatterHeading(line, metrics, medianLineHeight))
  ) {
    return 'heading';
  }
  return 'paragraph';
}

function looksLikeInlineFigureReferenceContinuation(previous: TextLine | undefined, line: TextLine): boolean {
  if (!previous || !/^(fig\.?|figure)\s*\d+[:.]/iu.test(line.text.trim())) {
    return false;
  }
  const verticalGap = line.y - previous.y;
  return Math.abs(line.x - previous.x) <= 24 &&
    verticalGap > 0 &&
    verticalGap <= Math.max(18, previous.height * 2, line.height * 2) &&
    countWords(previous.text) >= 6 &&
    !endsWithSentenceBoundary(previous.text);
}

function looksLikeReaderAffiliation(text: string): boolean {
  const normalized = text.trim();
  const numberedPrefix = /^\d+(?:\s*[,;*†‡]\s*\d+)*\s+/u.test(normalized);
  const affiliationVocabulary = /\b(?:department|university|institute|istituto|institut|school|college|laborator(?:y|ies)|lab|cent(?:er|re)|faculty|technology|robotics|perception|embodied ai)\b/iu;
  if (
    numberedPrefix && (
      affiliationVocabulary.test(normalized) ||
      (countWords(normalized) >= 7 && (normalized.match(/,/gu) ?? []).length >= 1) ||
      (((normalized.match(/,/gu) ?? []).length >= 2) && /\b(?:are|is)$/iu.test(normalized))
    )
  ) {
    return true;
  }
  return /^\d+(?:\s*[,;*†‡]\s*|\s+).{0,40}\b(?:department|university|institute|school|college|laborator(?:y|ies)|lab|research cent(?:er|re)|faculty)\b/iu.test(
    text.trim()
  );
}

function isReaderFrontMatterHeading(line: TextLine, metrics: PageTextMetrics, medianLineHeight: number): boolean {
  const nearTop = line.y <= metrics.minY + metrics.height * 0.28;
  if (
    !nearTop ||
    line.height < medianLineHeight * 1.4 ||
    countWords(line.text) > 18 ||
    /^(https?:\/\/|www\.|[\w.-]+\.[a-z]{2,})/iu.test(line.text.trim())
  ) {
    return false;
  }
  const pageCenter = metrics.minX + metrics.width / 2;
  const centered = Math.abs(getLineCenterX(line) - pageCenter) <= Math.max(55, metrics.width * 0.16);
  return centered || line.height >= medianLineHeight * 1.45;
}

function getLineCenterX(line: TextLine): number {
  const minX = Math.min(...line.items.map((item) => item.x));
  const maxX = Math.max(...line.items.map((item) => item.x + item.width));
  return (minX + maxX) / 2;
}

function containsReadableText(text: string): boolean {
  return /[\p{L}\p{N}=∑∫√∞≤≥≠≈→]/u.test(text);
}

function classifyLine(text: string): ExtractedBlockType {
  const normalized = text.trim();

  if (/^(fig\.?|figure|table)\s*[\divxlcdm]*[:.]/iu.test(normalized)) {
    return 'caption';
  }

  if (isFormulaLike(normalized)) {
    return 'formula';
  }

  if (/^([IVX]+\.\s+)?[A-Z][A-Z0-9 ,:;()/-]{4,}$/u.test(normalized)) {
    return 'heading';
  }

  if (looksLikeSectionHeading(normalizeSectionHeading(normalized))) {
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
    return !/^references$/iu.test(normalized) && !/^[A-Z]\.\s+Contributions$/u.test(normalized) && looksLikeSectionHeading(normalized);
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
  _currentSection: string,
  inlineSection: { section: string; body: string } | null,
  lines: TextLine[],
  firstInlineAbstractY: number | null
): boolean {
  if (page !== 1 || inlineSection || lines.length === 0 || firstInlineAbstractY === null) {
    return false;
  }

  const firstY = Math.min(...lines.map((line) => line.y));
  return firstY < firstInlineAbstractY - 4;
}

function looksLikeSectionHeading(text: string): boolean {
  const normalized = text.trim();
  return (
    /^(abstract|introduction|related work|method|methods|experiments?|results?|discussion|conclusion|references)s?$/iu.test(
      normalized
    ) ||
    /^([IVX]+|\d+(?:\.\d+)*)\.?\s+\p{Lu}[\p{L}\p{N} ,:;()/-]{3,}$/u.test(normalized) ||
    /^[A-Z]\.\s+\p{Lu}[\p{L}\p{N} ,:;()/-]{3,}$/u.test(normalized)
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

function normalizeReaderCaption(text: string): string {
  const normalized = text.trim();
  const tablePrefix = normalized.match(/^(TABLE\s+[IVXLCDM\d]+)(.*)$/u);
  if (tablePrefix) {
    return normalizeExtractedText(`${tablePrefix[1]} ${normalizeSectionHeading(tablePrefix[2])}`);
  }
  return normalizeSectionHeading(normalized);
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

  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const citationTokens = text.match(/\[\d+(?:\s*[-,]\s*\d+)*\]/gu) ?? [];
  const withoutCitations = citationTokens.reduce((value, token) => value.replace(token, ''), text);
  const strongMathSymbols = (withoutCitations.match(/[=∑∫√∞≤≥≠≈→^_{}]/gu) ?? []).length;
  const operatorSymbols = (withoutCitations.match(/[+*/]/gu) ?? []).length;
  if (strongMathSymbols === 0 && (letters >= 3 || operatorSymbols < 2)) {
    return false;
  }
  const mathSymbols = strongMathSymbols + operatorSymbols + (withoutCitations.match(/[()[\]]/gu) ?? []).length;
  if (/=/u.test(withoutCitations) && /[\u0370-\u03ff]/iu.test(withoutCitations) && mathSymbols >= 3) {
    return true;
  }
  return mathSymbols >= 3 && mathSymbols >= letters * 0.35;
}

function joinParagraphLines(lines: string[]): string {
  const joined = lines.reduce((paragraph, line) => {
    if (!paragraph) {
      return line.trim();
    }

    if (/[-\u00ad\u2010-\u2015]$/u.test(paragraph)) {
      const prefix = paragraph.match(/([A-Za-z]+)[-\u00ad\u2010-\u2015]$/u)?.[1] ?? '';
      if (!prefix || !/^\p{Ll}/u.test(line.trim())) {
        return paragraph + line.trim();
      }
      const separator = shouldPreserveCompoundHyphen(prefix) ? '-' : '';
      return paragraph.replace(/[-\u00ad\u2010-\u2015]$/u, '') + separator + line.trim();
    }

    return `${paragraph} ${line.trim()}`;
  }, '');
  return normalizeExtractedText(joined);
}

function shouldPreserveCompoundHyphen(prefix: string): boolean {
  return /^(?:whole|multi|real|contact|end|lower|upper|hand|single|loco|thin|tight|tool|low|high|long|short|cross|open|closed|force|task|pose|motion|robot|sensor|vision|tactile|policy|model|world|latent|pretrain|small|large|fine|self|non|gpu)$/iu.test(prefix);
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,;:!?]|\.(?!\.))/gu, '$1')
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
  original: string,
  bounds?: PdfBlockBounds
): ExtractedPdfBlock {
  const sourceHash = hashText(`${page}|${type}|${section}|${original}`);

  return {
    id: `pdf-${page}-${sourceHash}`,
    section,
    original,
    translation: '',
    type,
    page,
    sourceHash,
    bounds
  };
}

function getLinesBounds(lines: TextLine[]): PdfBlockBounds | undefined {
  const items = lines.flatMap((line) => line.items);
  if (items.length === 0) {
    return undefined;
  }

  const minX = Math.min(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));
  const pageWidth = items.find((item) => typeof item.pageWidth === 'number')?.pageWidth;
  const pageHeight = items.find((item) => typeof item.pageHeight === 'number')?.pageHeight;

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    pageWidth,
    pageHeight
  };
}

function mergeBounds(left?: PdfBlockBounds, right?: PdfBlockBounds): PdfBlockBounds | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (typeof left.pageWidth === 'number' && typeof right.pageWidth === 'number' && left.pageWidth !== right.pageWidth) {
    return left;
  }

  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    pageWidth: left.pageWidth ?? right.pageWidth,
    pageHeight: left.pageHeight ?? right.pageHeight
  };
}

export function hashText(value: string): string {
  let hash = 2166136261;
  const text = String(value);
  // Use UTF-16 indexing instead of String's iterator. Some iPhone Safari
  // runtimes expose an incomplete iterator while processing PDF.js text items,
  // which made `for...of` fail before the first extracted block was cached.
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
