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
    mergeReaderCaptionContinuationLines(
      orderLinesForReaderLayout(captionMergedLines, page, metrics)
    ),
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

    const original = joinParagraphLines(currentParagraph.map((line) => line.text));
    splitReaderParagraphText(original).forEach((paragraph) => {
      const inlineSection = extractInlineSection(paragraph);
      const section = inlineSection?.section ?? currentSection;
      const paragraphBody = inlineSection?.body ?? paragraph;
      if (inlineSection) {
        currentSection = inlineSection.section;
      }
      if (containsReadableText(paragraphBody)) {
        blocks.push(createBlock(page, 'paragraph', section, paragraphBody, getLinesBounds(currentParagraph)));
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
    const continuesBracketedReference = /^\[\d{1,4}\]\s/u.test(currentParagraph[0]?.text.trim() ?? '') &&
      !/^\[\d{1,4}\]\s/u.test(line.text.trim());
    const paragraphGapThreshold = previousLine
      ? Math.max(medianLineStep * 1.3, previousLine.height * 1.45, line.height * 1.45)
      : PARAGRAPH_GAP_THRESHOLD;
    if (
      previousLine &&
      (lineIsAffiliation !== previousIsAffiliation ||
        Math.abs(line.y - previousLine.y) > paragraphGapThreshold ||
        (!continuesBracketedReference && Math.abs(line.x - previousLine.x) > COLUMN_SPLIT_THRESHOLD / 2) ||
        hasSignificantReaderFontChange(previousLine, line) ||
        startsNewReaderParagraph(currentParagraph, line))
    ) {
      flushParagraph();
    }
    currentParagraph.push(line);
  });

  flushParagraph();
  return mergeReaderReferenceContinuations(mergeReaderBlockContinuations(blocks));
}

function mergeReaderReferenceContinuations(blocks: ExtractedPdfBlock[]): ExtractedPdfBlock[] {
  const referenceEntryCount = blocks.filter((block) => /^\[\d{1,4}\]\s/u.test(block.original.trim())).length;
  if (referenceEntryCount < 2) {
    return blocks;
  }
  const merged: ExtractedPdfBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const previous = merged.at(-1);
    const next = blocks[index + 1];
    const venueHeading = block.type === 'heading' &&
      /^(?:19|20)\d{2}\s+(?:IEEE|ACM|International|Conference|Transactions|Proceedings)\b/iu
        .test(block.original.trim());
    if (
      venueHeading &&
      previous?.type === 'paragraph' &&
      next?.type === 'paragraph' &&
      !/^\[\d{1,4}\]\s/u.test(next.original.trim())
    ) {
      merged[merged.length - 1] = createBlock(
        previous.page,
        'paragraph',
        previous.section,
        joinParagraphLines([previous.original, block.original, next.original]),
        mergeBounds(mergeBounds(previous.bounds, block.bounds), next.bounds)
      );
      index += 1;
      continue;
    }
    merged.push(block);
  }
  return merged;
}

function orderLinesForReaderLayout<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>,
  page: number,
  metrics: PageTextMetrics
): Array<TextLine<TItem>> {
  if (looksLikeSingleColumnReferenceLayout(lines, metrics)) {
    return mergeSingleColumnReferenceRowFragments(lines, metrics)
      .sort((left, right) => left.y - right.y || left.x - right.x);
  }
  if (page !== 1) {
    const topCenteredTableCaptions = lines.filter((line) => (
      /^TABLE\s+[IVXLCDM\d]+(?:\s+|$)/u.test(line.text.trim()) &&
      line.y <= metrics.minY + metrics.height * 0.18 &&
      Math.abs(getLineCenterX(line) - (metrics.minX + metrics.width / 2)) <= Math.max(55, metrics.width * 0.14)
    ));
    const remainingLines = lines.filter((line) => !topCenteredTableCaptions.includes(line));
    return [
      ...topCenteredTableCaptions.sort((left, right) => left.y - right.y || left.x - right.x),
      ...orderParallelCaptionBands(orderLinesForAcademicLayout(remainingLines), metrics)
    ];
  }
  const frontMatterLimit = metrics.minY + metrics.height * 0.18;
  const pageCenter = metrics.minX + metrics.width / 2;
  const frontMatter = lines
    .filter((line) => (
      line.y <= frontMatterLimit &&
      (
        Math.abs(getLineCenterX(line) - pageCenter) <= Math.max(55, metrics.width * 0.16) ||
        looksLikePageOneFrontMatterLine(line)
      )
    ))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const body = lines.filter((line) => !frontMatter.includes(line));
  const pageFootnotes = body
    .filter((line) => looksLikePageOneFootnoteLine(line.text))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const orderedBody = orderParallelCaptionBands(
    orderLinesForAcademicLayout(body.filter((line) => !pageFootnotes.includes(line))),
    metrics
  );
  // Keep page-one author notes with the metadata they describe. Appending them
  // after the article body can place a corresponding-author note between the
  // final line on page one and its continuation on page two.
  return [...frontMatter, ...pageFootnotes, ...orderedBody];
}

function looksLikePageOneFrontMatterLine(line: TextLine): boolean {
  const text = line.text.trim();
  if (
    !text ||
    /^(?:abstract|introduction|fig(?:ure)?\.?|table)\b/iu.test(text) ||
    /[.!?。！？]\s*$/u.test(text)
  ) {
    return looksLikeReaderAffiliation(text);
  }
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 2 || words.length > 28 || text.length > 220) {
    return false;
  }
  const titleLikeWords = words.filter((word) => /^\p{Lu}/u.test(word)).length;
  return looksLikeReaderAffiliation(text) ||
    /https?:\/\//iu.test(text) ||
    /[∗†‡♮*]/u.test(text) ||
    titleLikeWords / words.length >= 0.45;
}

function looksLikePageOneFootnoteLine(text: string): boolean {
  return /^[∗†‡♮*]\s*(?:equal contribution|corresponding author|core contributors|project lead|work done)\b/iu
    .test(text.trim());
}

function orderParallelCaptionBands<TItem extends PositionedPdfTextItem>(
  orderedLines: Array<TextLine<TItem>>,
  metrics: PageTextMetrics
): Array<TextLine<TItem>> {
  const pageCenter = metrics.minX + metrics.width / 2;
  const captionAnchors = orderedLines.filter((line) =>
    /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+[:.]/iu.test(line.text.trim())
  );
  const bandStarts = captionAnchors
    .filter((anchor) => anchor.x < pageCenter)
    .flatMap((leftAnchor) => {
      const rightAnchor = captionAnchors.find((candidate) =>
        candidate.x >= pageCenter &&
        Math.abs(candidate.y - leftAnchor.y) <= Math.max(10, leftAnchor.height * 2, candidate.height * 2)
      );
      return rightAnchor ? [Math.min(leftAnchor.y, rightAnchor.y)] : [];
    })
    .filter((bandY, index, all) => all.findIndex((candidate) => Math.abs(candidate - bandY) <= 2) === index)
    .sort((left, right) => left - right);

  return bandStarts.reduce((currentLines, bandY) => {
    const bandBottom = bandY + Math.max(40, metrics.medianLineHeight * 5);
    const bandLines = currentLines.filter((line) => {
      const minX = Math.min(...line.items.map((item) => item.x));
      const maxX = Math.max(...line.items.map((item) => item.x + item.width));
      return line.y >= bandY - 2 &&
        line.y <= bandBottom &&
        maxX - minX <= metrics.width * 0.62;
    });
    const leftLines = bandLines
      .filter((line) => getLineCenterX(line) < pageCenter)
      .sort((left, right) => left.y - right.y || left.x - right.x);
    const rightLines = bandLines
      .filter((line) => getLineCenterX(line) >= pageCenter)
      .sort((left, right) => left.y - right.y || left.x - right.x);
    if (leftLines.length === 0 || rightLines.length === 0) {
      return currentLines;
    }
    const bandSet = new Set(bandLines);
    const firstBandIndex = currentLines.findIndex((line) => bandSet.has(line));
    const insertionIndex = currentLines
      .slice(0, Math.max(0, firstBandIndex))
      .filter((line) => !bandSet.has(line))
      .length;
    const remaining = currentLines.filter((line) => !bandSet.has(line));
    return [
      ...remaining.slice(0, insertionIndex),
      ...leftLines,
      ...rightLines,
      ...remaining.slice(insertionIndex)
    ];
  }, orderedLines);
}

function looksLikeSingleColumnReferenceLayout<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>,
  metrics: PageTextMetrics
): boolean {
  const referenceStarts = lines.filter((line) => /^\[\d{1,4}\]\s/u.test(line.text.trim()));
  if (referenceStarts.length < 2) {
    return false;
  }
  const leftEdges = referenceStarts.map((line) => line.x);
  const alignedToContentEdge =
    Math.min(...leftEdges) - metrics.minX <= Math.max(48, metrics.width * 0.12);
  return alignedToContentEdge &&
    Math.max(...leftEdges) - Math.min(...leftEdges) <= Math.max(36, metrics.width * 0.12);
}

function mergeSingleColumnReferenceRowFragments<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>,
  _metrics: PageTextMetrics
): Array<TextLine<TItem>> {
  const rowGroups: Array<Array<TextLine<TItem>>> = [];
  for (const line of [...lines].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const row = rowGroups.find((candidates) => {
      const reference = candidates[0];
      return Math.abs(reference.y - line.y) <= Math.max(4, Math.min(reference.height, line.height) * 0.9);
    });
    if (row) {
      row.push(line);
    } else {
      rowGroups.push([line]);
    }
  }
  return rowGroups.map((row) => {
    const combinedItems = row.flatMap((line) => line.items).sort((left, right) => left.x - right.x);
    return {
      text: normalizeExtractedText(combinedItems.map((item) => item.str.trim()).join(' ')),
      x: Math.min(...row.map((line) => line.x)),
      y: Math.min(...row.map((line) => line.y)),
      height: Math.max(...row.map((line) => line.height)),
      items: combinedItems
    };
  });
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
      (!/^table\b/iu.test(previous.original.trim()) || countWords(block.original) <= 28) &&
      (
        /[-\u00ad\u2010-\u2015]$/u.test(previous.original.trim()) ||
        startsWithLowercaseContinuation(block.original) ||
        (/^table\b/iu.test(previous.original.trim()) && /[:(]\s*$/u.test(previous.original.trim())) ||
        /\b(?:a|an|and|as|at|between|by|for|from|in|of|on|or|the|to|with)\s*$/iu.test(previous.original.trim())
      );
    const mergeParagraph = previous?.type === 'paragraph' && block.type === 'paragraph' &&
      previous.section === block.section &&
      !looksLikeReaderTableCellFragment(previous.original) &&
      !/^[a-z]\)\s+\p{Lu}[^:]{2,100}:/u.test(block.original.trim()) &&
      !/^\[\d{1,4}\]\s/u.test(block.original.trim()) &&
      !/^https?:\/\//iu.test(previous.original.trim()) &&
      !/^https?:\/\//iu.test(block.original.trim()) &&
      !looksLikeReaderAffiliation(previous.original) &&
      !looksLikeReaderAffiliation(block.original) &&
      !/^\d+\)\s+\p{Lu}[^:]{2,100}:\s+\p{Lu}/u.test(block.original) &&
      !endsWithSentenceBoundary(previous.original) &&
      (areReaderParagraphBlocksContiguous(previous, block) || isLikelyReaderProseContinuation(previous, block));
    const mergeOverlaidRunInLabel = previous?.type === 'paragraph' &&
      block.type === 'paragraph' &&
      previous.page === block.page &&
      previous.section === block.section &&
      previous.original.trim().length <= 80 &&
      !/^[a-z]\)\s+\p{Lu}[^:]{2,100}:/u.test(block.original.trim()) &&
      /(?:\bvs\.|[-\u2010-\u2015/:])$/iu.test(previous.original.trim()) &&
      haveNearlyIdenticalReaderBounds(previous.bounds, block.bounds);
    const mergeHeading = previous?.type === 'heading' && block.type === 'paragraph' &&
      /[-\u00ad\u2010-\u2015]$/u.test(previous.original.trim()) &&
      countWords(block.original) <= 16;
    if (
      previous &&
      (
        forcedHyphenContinuation ||
        decimalSentenceContinuation ||
        mergeCaption ||
        mergeParagraph ||
        mergeOverlaidRunInLabel ||
        mergeHeading
      )
    ) {
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
  return repairReaderMathBoundaries(mergeReaderParagraphsAcrossFloatingCaptions(merged));
}

function haveNearlyIdenticalReaderBounds(left?: PdfBlockBounds, right?: PdfBlockBounds): boolean {
  if (!left || !right) {
    return false;
  }
  return Math.abs(left.x - right.x) <= 3 &&
    Math.abs(left.y - right.y) <= 3 &&
    Math.abs(left.width - right.width) <= Math.max(4, left.width * 0.03) &&
    Math.abs(left.height - right.height) <= Math.max(4, left.height * 0.08);
}

function repairReaderMathBoundaries(blocks: ExtractedPdfBlock[]): ExtractedPdfBlock[] {
  const splitBlocks: ExtractedPdfBlock[] = [];
  for (const block of blocks) {
    if (block.type !== 'paragraph') {
      splitBlocks.push(block);
      continue;
    }
    const segments = splitReaderMathAndBulletBlock(block);
    splitBlocks.push(...segments);
  }

  const repaired: ExtractedPdfBlock[] = [];
  for (let index = 0; index < splitBlocks.length; index += 1) {
    const block = splitBlocks[index];
    const next = splitBlocks[index + 1];
    if (block.type === 'formula' && isEquationNumberFragment(block.original)) {
      let precedingFormulaIndex = -1;
      for (let candidateIndex = repaired.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
        const candidate = repaired[candidateIndex];
        if (
          candidate.type === 'formula' &&
          candidate.page === block.page &&
          verticalBoundsOverlap(candidate.bounds, block.bounds)
        ) {
          precedingFormulaIndex = candidateIndex;
          break;
        }
      }
      if (precedingFormulaIndex >= 0) {
        const precedingFormula = repaired[precedingFormulaIndex];
        repaired[precedingFormulaIndex] = createBlock(
          precedingFormula.page,
          'formula',
          precedingFormula.section,
          joinParagraphLines([precedingFormula.original, block.original]),
          mergeBounds(precedingFormula.bounds, block.bounds)
        );
        continue;
      }
    }
    if (
      block.type === 'formula' &&
      isEquationNumberFragment(block.original) &&
      next?.type === 'formula' &&
      block.page === next.page &&
      verticalBoundsOverlap(block.bounds, next.bounds)
    ) {
      repaired.push(createBlock(
        next.page,
        'formula',
        next.section,
        joinParagraphLines([next.original, block.original]),
        mergeBounds(block.bounds, next.bounds)
      ));
      index += 1;
      continue;
    }
    const previous = repaired[repaired.length - 1];
    if (
      previous?.type === 'formula' &&
      block.type === 'formula' &&
      previous.page === block.page &&
      (
        isEquationNumberFragment(block.original) ||
        isFormulaSuffixFragment(block.original) ||
        verticalBoundsOverlap(previous.bounds, block.bounds)
      )
    ) {
      repaired[repaired.length - 1] = createBlock(
        previous.page,
        'formula',
        previous.section,
        joinParagraphLines([previous.original, block.original]),
        mergeBounds(previous.bounds, block.bounds)
      );
      continue;
    }
    repaired.push(block);
  }
  return repaired;
}

function splitReaderMathAndBulletBlock(block: ExtractedPdfBlock): ExtractedPdfBlock[] {
  const original = block.original.trim();
  const bulletIndex = original.indexOf('•');
  if (bulletIndex > 0) {
    const prefix = original.slice(0, bulletIndex).trim();
    const bullet = original.slice(bulletIndex).trim();
    const prefixType: ExtractedBlockType = /^\d+\)\s+[^:]{2,100}:$/u.test(prefix)
      ? 'heading'
      : looksLikeStandaloneEquation(prefix) ||
          isEquationNumberFragment(prefix) ||
          isFormulaSuffixFragment(prefix)
        ? 'formula'
        : 'paragraph';
    return [
      createBlock(
        block.page,
        prefixType,
        prefixType === 'heading' ? prefix : block.section,
        prefix,
        block.bounds
      ),
      createBlock(block.page, 'paragraph', block.section, bullet, block.bounds)
    ];
  }

  const whereIndex = original.search(/\s+where\s+/iu);
  if (whereIndex > 0) {
    const prefix = original.slice(0, whereIndex).trim();
    const explanation = original.slice(whereIndex).trim();
    if (looksLikeStandaloneEquation(prefix) || isFormulaSuffixFragment(prefix)) {
      return [
        createBlock(block.page, 'formula', block.section, prefix, block.bounds),
        createBlock(block.page, 'paragraph', block.section, explanation, block.bounds)
      ];
    }
  }

  if (looksLikeStandaloneEquation(original) || isEquationNumberFragment(original)) {
    return [createBlock(block.page, 'formula', block.section, original, block.bounds)];
  }
  return [block];
}

function looksLikeStandaloneEquation(text: string): boolean {
  const normalized = text.trim();
  if (
    normalized.length > 240 ||
    !/[=∑∏∫√]/u.test(normalized) ||
    /^where\b/iu.test(normalized)
  ) {
    return false;
  }
  const proseWords = normalized
    .match(/[A-Za-z]{4,}/gu)
    ?.filter((word) => !/^(?:arccos|clip|cosh|exp|log|max|min|rank|ref|root|sin|sqrt|tanh)$/iu.test(word)) ?? [];
  return proseWords.length <= 1;
}

function isEquationNumberFragment(text: string): boolean {
  return /^\(\d{1,3}\)$/u.test(text.trim());
}

function looksLikeReaderTableCellFragment(text: string): boolean {
  const normalized = text.trim();
  return normalized.length <= 32 &&
    /^[+\-−–—±]?\d+(?:\.\d+)?(?:\s*(?:%|rad|m|s|cm|mm))?$/iu.test(normalized);
}

function isFormulaSuffixFragment(text: string): boolean {
  const normalized = text.trim();
  return /^(?:\(\d{1,3}\)\s*)?(?:ref|target|[012])(?:\s+(?:ref|target|[a-z\d])){0,7}$/iu.test(normalized) ||
    /^\(\d{1,3}\)(?:\s+[a-z\d]+){1,8}$/iu.test(normalized) ||
    /^[012]\s*\(\d{1,3}\)$/u.test(normalized);
}

function verticalBoundsOverlap(left?: PdfBlockBounds, right?: PdfBlockBounds): boolean {
  if (!left || !right) {
    return false;
  }
  const overlap = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return overlap >= -Math.max(3, Math.min(left.height, right.height) * 0.4);
}

function mergeReaderParagraphsAcrossFloatingCaptions(blocks: ExtractedPdfBlock[]): ExtractedPdfBlock[] {
  const merged: ExtractedPdfBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const previous = blocks[index];
    const caption = blocks[index + 1];
    const continuation = blocks[index + 2];
    const crossesFloatingCaption = previous?.type === 'paragraph' &&
      caption?.type === 'caption' &&
      continuation?.type === 'paragraph' &&
      previous.page === caption.page &&
      caption.page === continuation.page &&
      previous.section === continuation.section &&
      !endsWithSentenceBoundary(previous.original) &&
      startsWithLowercaseContinuation(continuation.original);
    if (!crossesFloatingCaption) {
      merged.push(previous);
      continue;
    }
    merged.push(createBlock(
      previous.page,
      'paragraph',
      previous.section,
      joinParagraphLines([previous.original, continuation.original]),
      mergeBounds(previous.bounds, continuation.bounds)
    ));
    merged.push(caption);
    index += 2;
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
  if (/^\[\d{1,4}\]\s/u.test(nextText)) {
    return true;
  }
  if (/^\[\d{1,4}\]\s/u.test(currentParagraph[0].text.trim())) {
    return false;
  }
  const baselineDelta = Math.abs(nextLine.y - previousLine.y);
  if (baselineDelta <= Math.max(4, Math.min(previousLine.height, nextLine.height) * 0.9)) {
    return false;
  }
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
  if (/^\[\d{1,4}\]\s/u.test(text.trim())) {
    const bracketedReferenceBoundaries = [...text.matchAll(/\s+(?=\[\d{1,4}\]\s)/gu)]
      .map((match) => (match.index ?? 0) + match[0].length);
    if (bracketedReferenceBoundaries.length === 0) {
      return [text];
    }
    const references: string[] = [];
    let referenceStart = 0;
    for (const boundary of bracketedReferenceBoundaries) {
      references.push(text.slice(referenceStart, boundary).trim());
      referenceStart = boundary;
    }
    references.push(text.slice(referenceStart).trim());
    return references.filter(Boolean);
  }
  const headingBoundaries = [...text.matchAll(/[.!?。！？][)"'\]]*\s+/gu)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => index > 0 && looksLikeRunInAcademicHeadingStart(text.slice(index)));
  const numberedRunInBoundaries = [...text.matchAll(/\s+(?=\d+\)\s+\p{Lu}[^:]{2,100}:\s+\p{Lu})/gu)]
    .map((match) => (match.index ?? 0) + match[0].length);
  const letteredRunInBoundaries = [...text.matchAll(/:\s+(?=[a-z]\)\s+\p{Lu}[^:]{2,100}:)/gu)]
    .map((match) => (match.index ?? 0) + match[0].length);
  const referenceMatches = [...text.matchAll(/(?:^|\s)(?=\d{1,3}\.\s+\p{Lu}[\p{L}'-]+,\s*\p{Lu}\.)/gu)];
  const referenceBoundaries = referenceMatches.length >= 2
    ? referenceMatches.map((match) => (match.index ?? 0) + match[0].length)
    : [];
  const semanticBoundaries = [...text.matchAll(
    /\s+(?=(?:Abstract\s*[:\u2014-]|[\u2217\u2020]\s*(?:Core contributors?|Corresponding authors?)))/giu
  )].map((match) => (match.index ?? 0) + match[0].length);
  const projectUrlBoundaries = [...text.matchAll(/\s+(?=https?:\/\/)/giu)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => /^https?:\/\/\S+\s+Abstract\s*[:\u2014-]/iu.test(text.slice(index)));
  const boundaries = Array.from(new Set([
    ...headingBoundaries,
    ...numberedRunInBoundaries,
    ...letteredRunInBoundaries,
    ...referenceBoundaries,
    ...semanticBoundaries,
    ...projectUrlBoundaries
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
  const pageWidth = items.find((item) => typeof item.pageWidth === 'number' && item.pageWidth > 0)?.pageWidth ?? 0;
  const contentMinX = items.length > 0 ? Math.min(...items.map((item) => item.x)) : 0;
  const contentMaxX = Math.max(1, ...items.map((item) => item.x + item.width));
  const likelyColumnSplitX = pageWidth > 0 ? pageWidth / 2 : (contentMinX + contentMaxX) / 2;
  const referenceColumnAnchors = pageWidth > 0
    ? items
      .filter((item) => /^\[\d{1,4}\]\s/u.test(item.str.trim()))
    : [];
  const captionColumnAnchors = pageWidth > 0
    ? items
      .filter((item) => /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+[:.]/iu.test(item.str.trim()))
    : [];
  const hasParallelReferenceAnchors = referenceColumnAnchors.some((item) => item.x < pageWidth * 0.45) &&
    referenceColumnAnchors.some((item) => item.x > pageWidth * 0.5);
  const leftReferenceAnchors = referenceColumnAnchors.filter((item) => item.x < pageWidth / 2);
  const rightReferenceAnchors = referenceColumnAnchors.filter((item) => item.x >= pageWidth / 2);
  const oneSidedReferenceAnchors = leftReferenceAnchors.length >= 2 && rightReferenceAnchors.length === 0
    ? leftReferenceAnchors
    : rightReferenceAnchors.length >= 2 && leftReferenceAnchors.length === 0
      ? rightReferenceAnchors
      : [];
  const oneSidedReferenceStartY = oneSidedReferenceAnchors.length > 0
    ? Math.min(...oneSidedReferenceAnchors.map((item) => item.y)) -
      Math.max(12, Math.max(...oneSidedReferenceAnchors.map((item) => item.height)) * 2.5)
    : Number.POSITIVE_INFINITY;
  const parallelCaptionAnchorYs = captionColumnAnchors
    .filter((anchor) =>
      captionColumnAnchors.some((candidate) =>
        candidate !== anchor &&
        (anchor.x < pageWidth / 2) !== (candidate.x < pageWidth / 2) &&
        Math.abs(anchor.y - candidate.y) <= Math.max(10, anchor.height * 2, candidate.height * 2)
      )
    )
    .map((anchor) => anchor.y);
  const sortedItems = items
    .filter((item) => item.str.trim())
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const lines: TItem[][] = [];

  sortedItems.forEach((item) => {
    const line = lines.find((candidate) => {
      const reference = candidate[0];
      const candidateHeight = Math.max(...candidate.map((candidateItem) => candidateItem.height));
      return Math.abs(reference.y - item.y) <= Math.max(4, candidateHeight * 0.75);
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
      const nearbyWideSingleColumnRun = pageWidth > 0 && items.some((candidate) => (
        candidate !== item &&
        candidate.width >= pageWidth * 0.55 &&
        candidate.x <= pageWidth * 0.28 &&
        candidate.x + candidate.width >= pageWidth * 0.72 &&
        Math.abs(candidate.y - item.y) <= Math.max(20, candidate.height * 2.2, item.height * 2.2)
      ));
      const likelyDifferentColumns =
        previousItem &&
        horizontalGap > 8 &&
        !nearbyWideSingleColumnRun &&
        (
          pageWidth > 0
            ? previousItem.x + previousItem.width <= likelyColumnSplitX + 6 &&
              item.x >= likelyColumnSplitX - 2
            : currentSegmentWidth >= 120 &&
              currentSegmentWidth <= 320 &&
              item.x - currentSegment[0].x >= 240
        );
      const crossesPageMidpoint =
        previousItem &&
        pageWidth > 0 &&
        (
          hasParallelReferenceAnchors ||
          item.y >= oneSidedReferenceStartY ||
          parallelCaptionAnchorYs.some((anchorY) =>
            Math.abs(anchorY - item.y) <= Math.max(40, item.height * 5)
          )
        ) &&
        currentSegment[0].x < pageWidth / 2 - 4 &&
        item.x >= pageWidth / 2 + 2;

      if (
        !currentSegment ||
        horizontalGap > LINE_SEGMENT_GAP_THRESHOLD ||
        likelyDifferentBaselines ||
        likelyDifferentColumns ||
        crossesPageMidpoint
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
  const pageWidth = lines
    .flatMap((line) => line.items)
    .find((item) => typeof item.pageWidth === 'number' && item.pageWidth > 0)
    ?.pageWidth;

  if (maxX - minX < COLUMN_SPLIT_THRESHOLD) {
    return [...lines].sort((left, right) => left.y - right.y || left.x - right.x);
  }

  const splitX = pageWidth ? pageWidth / 2 : (minX + maxX) / 2;
  const leftColumn = lines
    .filter((line) => line.x < splitX)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const rightColumn = lines
    .filter((line) => line.x >= splitX)
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

function mergeReaderCaptionContinuationLines<TItem extends PositionedPdfTextItem>(
  lines: Array<TextLine<TItem>>
): Array<TextLine<TItem>> {
  const merged: Array<TextLine<TItem>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    let current = lines[index];
    if (!/^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]/iu.test(current.text.trim())) {
      merged.push(current);
      continue;
    }
    while (!/[.!?。！？]\s*$/u.test(current.text.trim())) {
      const next = lines[index + 1];
      if (!next) {
        break;
      }
      const currentBottom = Math.max(...current.items.map((item) => item.y + item.height));
      const verticalGap = next.y - currentBottom;
      const aligned = Math.abs(current.x - next.x) <= 24 ||
        Math.abs(getLineCenterX(current) - getLineCenterX(next)) <= 36;
      if (
        verticalGap < -2 ||
        verticalGap > Math.max(10, current.height * 1.6, next.height * 1.6) ||
        !aligned ||
        !/^\p{Ll}/u.test(next.text.trim())
      ) {
        break;
      }
      const combinedItems = [...current.items, ...next.items];
      current = {
        text: joinParagraphLines([current.text, next.text]),
        x: Math.min(current.x, next.x),
        y: Math.min(current.y, next.y),
        height: Math.max(current.height, next.height),
        items: combinedItems
      };
      index += 1;
    }
    merged.push(current);
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
  const currentLastLineY = Math.max(current.y, ...current.items.map((item) => item.y));
  const verticalGap = next.y - currentLastLineY;
  if (verticalGap <= 0 || verticalGap > Math.max(current.height * 1.9, next.height * 1.9, medianLineHeight * 3)) {
    return false;
  }
  const centersAligned = Math.abs(getLineCenterX(current) - getLineCenterX(next)) <= Math.max(45, metrics.width * 0.12);
  const leftAligned = Math.abs(current.x - next.x) <= 24;
  const nextWords = countWords(next.text);
  const connectiveWrap = /\b(and|for|of|on|to|with|without|in|under|from)\s*$/iu.test(current.text) ||
    /^(and|for|of|on|to|with|without|in|under|from)\b/iu.test(next.text.trim());
  const pageHeight = current.items.find((item) => typeof item.pageHeight === 'number' && item.pageHeight > 0)?.pageHeight ??
    metrics.maxY;
  const frontMatterConnectiveTitleWrap = page === 1 &&
    centersAligned &&
    current.y <= pageHeight * 0.3 &&
    current.text.includes(':') &&
    looksLikeFrontMatterTitle(current.text) &&
    connectiveWrap &&
    nextWords <= 8;
  if (frontMatterConnectiveTitleWrap) {
    return true;
  }
  const frontMatterWrap = page === 1 &&
    centersAligned &&
    isReaderFrontMatterHeading(current, metrics, medianLineHeight) &&
    isReaderFrontMatterHeading(next, metrics, medianLineHeight);
  if (frontMatterWrap) {
    return true;
  }

  const numberedHeading = /^([IVX]+|\d+(?:\.\d+)*|[A-Z])\.\s+/u.test(current.text.trim());
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
      /^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]/iu.test(normalized) ||
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
  if (isFormulaLike(normalized) && !looksLikeProseWithInlineMath(normalized)) {
    return 'formula';
  }
  if (
    /^([IVX]+\.\s+)?[A-Z][A-Z0-9 ,:;()/-]{4,}$/u.test(normalized) ||
    looksLikeSectionHeading(normalizeSectionHeading(normalized)) ||
    (
      page === 1 &&
      normalized.includes(':') &&
      line.y <= (
        line.items.find((item) => typeof item.pageHeight === 'number' && item.pageHeight > 0)?.pageHeight ??
        metrics.maxY
      ) * 0.3 &&
      looksLikeFrontMatterTitle(normalized)
    ) ||
    (page === 1 && isReaderFrontMatterHeading(line, metrics, medianLineHeight))
  ) {
    return 'heading';
  }
  return 'paragraph';
}

function looksLikeInlineFigureReferenceContinuation(previous: TextLine | undefined, line: TextLine): boolean {
  if (!previous || !/^(?:fig\.?|figure|table)\s*[\divxlcdm]+[:.]/iu.test(line.text.trim())) {
    return false;
  }
  const verticalGap = line.y - previous.y;
  const proseConnectors = previous.text.match(
    /\b(?:a|an|and|are|as|at|by|for|from|given|in|is|of|on|the|to|was|were|with)\b/giu
  ) ?? [];
  return Math.abs(line.x - previous.x) <= 24 &&
    verticalGap > 0 &&
    verticalGap <= Math.max(18, previous.height * 2, line.height * 2) &&
    countWords(previous.text) >= 6 &&
    proseConnectors.length >= 2 &&
    !endsWithSentenceBoundary(previous.text);
}

function looksLikeReaderAffiliation(text: string): boolean {
  const normalized = text.trim();
  if (looksLikePageOneFootnoteLine(normalized)) {
    return true;
  }
  const numberedPrefix = /^\d+(?:\s*[,;*†‡]\s*\d+)*\s+/u.test(normalized);
  const affiliationVocabulary = /\b(?:department|university|institute|istituto|institut|school|college|laborator(?:y|ies)|lab|cent(?:er|re)|faculty|technology|robotics|perception|artificial intelligence|embodied ai|ai)\b/iu;
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

  if (/^(?:fig(?:ure)?\.?|table)\s*[\divxlcdm]+\s*[:.]/iu.test(normalized)) {
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
    /^[A-Z]\.\s+\p{Lu}[\p{L}\p{N} ,:;()/-]{3,}$/u.test(normalized) ||
    /^[A-Z]\.\d+(?:\.\d+)*\.?\s+\p{Lu}[\p{L}\p{N} ,:;()/-]{3,}$/u.test(normalized)
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
  const match = text.match(/^(abstract|introduction|conclusion|references)\s*[:\u2013\u2014-]\s*(.+)$/iu);
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

function looksLikeProseWithInlineMath(text: string): boolean {
  const normalized = text.trim();
  const proseWords = text.match(/\b[A-Za-z]{2,}\b/gu) ?? [];
  if (
    proseWords.length >= 4 &&
    (
      /\bwhere\b/iu.test(normalized) ||
      /[.!?;:]\s*(?:however|therefore|for|in|this|the|we)\b/iu.test(normalized)
    )
  ) {
    return true;
  }
  return proseWords.length >= 4 && /^["'“”‘’(]*[A-Za-z]{2,}\b/u.test(text.trim());
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
  return /^(?:whole|multi|real|contact|end|lower|upper|hand|single|loco|thin|tight|tool|low|medium|high|long|short|cross|open|closed|fixed|force|task|pose|motion|robot|sensor|vision|tactile|policy|model|world|latent|pretrain|small|large|fine|self|non|co|gpu|to|data)$/iu.test(prefix);
}

function normalizeExtractedText(text: string): string {
  const normalized = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,;:!?]|\.(?!\.))/gu, '$1')
    .replace(/(\d)\.\s+(\d)/gu, '$1.$2')
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1-$2')
    .replace(/\{\s+/gu, '{')
    .replace(/\s+\}/gu, '}')
    .replace(/\s+([’'])s\b/gu, '$1s')
    .replace(/([πΠ])\s+(\d)\s*\.\s*(\d)/gu, '$1$2.$3')
    .trim();
  const smallCapsPairs = normalized.match(/\b\p{Lu}\s+\p{Lu}{2,}\b/gu) ?? [];
  return smallCapsPairs.length >= 2
    ? normalized.replace(/\b(\p{Lu})\s+(\p{Lu}{2,})\b/gu, '$1$2')
    : normalized;
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

  if (isLikelyPublisherBrandChrome(line)) {
    return false;
  }

  if (isLikelySidebarLine(line, metrics)) {
    return false;
  }

  return true;
}

function isLikelyPublisherBrandChrome(line: TextLine): boolean {
  const normalized = line.text.trim();
  const page = line.items[0]?.page ?? 0;
  const pageHeight = line.items.find((item) => typeof item.pageHeight === 'number' && item.pageHeight > 0)?.pageHeight ?? 0;
  const nearTopBrandWord = pageHeight > 0 &&
    line.y <= pageHeight * 0.08 &&
    (/^BeingBeyond$/iu.test(normalized) || /^智在[无⽆]界$/u.test(normalized));
  return page === 1 &&
    !/\bBeing-H0(?:\.\d+)?\s*:/iu.test(normalized) &&
    (
      nearTopBrandWord ||
      (
        /\bBeingBeyond\b/iu.test(normalized) &&
        /[\u2e80-\u2fff\u3400-\u9fff]/u.test(normalized)
      ) ||
      (
        /^∝\s*/u.test(normalized) &&
        (
          /[\u2e80-\u2fff\u3400-\u9fff]/u.test(normalized) ||
          /\bBeingBeyond\b/iu.test(normalized)
        )
      )
    );
}

function isLikelyPageChrome(line: TextLine, metrics: PageTextMetrics): boolean {
  const normalized = line.text.trim();
  const pageHeight = line.items.find((item) => (
    typeof item.pageHeight === 'number' && item.pageHeight > 0
  ))?.pageHeight;
  const nearTop = pageHeight
    ? line.y <= Math.max(32, pageHeight * 0.065)
    : line.y <= metrics.minY + metrics.height * 0.08;
  const nearBottom = pageHeight
    ? line.y + line.height >= pageHeight * 0.93
    : line.y >= metrics.maxY - metrics.height * 0.08;

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
