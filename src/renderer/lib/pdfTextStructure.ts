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

const COLUMN_SPLIT_THRESHOLD = 220;
const PARAGRAPH_GAP_THRESHOLD = 24;
const LINE_SEGMENT_GAP_THRESHOLD = 36;

export function buildPdfPageOutline(page: number, items: PositionedPdfTextItem[]): ExtractedPdfBlock[] {
  const lines = buildLines(items);
  const orderedLines = orderLinesForAcademicLayout(lines);
  const medianLineHeight = median(lines.map((line) => line.height)) ?? PARAGRAPH_GAP_THRESHOLD / 2;
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

    if (shouldIncludeBlock('paragraph', original)) {
      blocks.push(createBlock(page, 'paragraph', section, original));
    }
    currentParagraph = [];
  }

  orderedLines.forEach((line) => {
    const type = classifyLine(line.text);

    if (type !== 'paragraph') {
      flushParagraph();
      const block = createBlock(page, type, type === 'heading' ? line.text.trim() : currentSection, line.text.trim());
      if (shouldIncludeBlock(type, block.original)) {
        blocks.push(block);
      }
      if (type === 'heading') {
        currentSection = line.text.trim();
      }
      return;
    }

    const previousLine = currentParagraph.at(-1);
    const paragraphGapThreshold = previousLine
      ? Math.max(medianLineHeight * 2.4, previousLine.height * 1.75, line.height * 1.75)
      : PARAGRAPH_GAP_THRESHOLD;
    if (
      previousLine &&
      (Math.abs(line.y - previousLine.y) > paragraphGapThreshold ||
        Math.abs(line.x - previousLine.x) > COLUMN_SPLIT_THRESHOLD / 2)
    ) {
      flushParagraph();
    }

    currentParagraph.push(line);
  });

  flushParagraph();
  return blocks;
}

export function buildPdfDocumentOutline(pages: Array<{ page: number; items: PositionedPdfTextItem[] }>): ExtractedPdfBlock[] {
  return pages.flatMap((page) => buildPdfPageOutline(page.page, page.items));
}

export function orderPositionedTextItemsForReading<TItem extends PositionedPdfTextItem>(
  items: TItem[]
): TItem[] {
  return orderLinesForAcademicLayout(buildLines(items)).flatMap((line) => line.items);
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

      if (!currentSegment || horizontalGap > LINE_SEGMENT_GAP_THRESHOLD) {
        segments.push([item]);
      } else {
        currentSegment.push(item);
      }
    });

    return segments.map((segmentItems) => ({
      text: segmentItems.map((item) => item.str.trim()).join(' ').replace(/\s+/g, ' ').trim(),
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
    return looksLikeSectionHeading(normalized);
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

  if (looksLikeFrontMatterTitle(text)) {
    return false;
  }

  if (sentenceMarks > 0) {
    return true;
  }

  // 没有句号的大段文本通常来自图中标签、作者单位或流程图节点，不作为正文段落送入 AI。
  return words <= 10;
}

function looksLikeSectionHeading(text: string): boolean {
  const normalized = text.trim();
  return (
    /^(abstract|introduction|related work|method|methods|experiments?|results?|discussion|conclusion)s?$/iu.test(
      normalized
    ) || /^([IVX]+|\d+)\.?\s+[A-Z][A-Z0-9 ,:;()/-]{3,}$/u.test(normalized)
  );
}

function extractInlineSection(text: string): { section: string; body: string } | null {
  const match = text.match(/^(abstract|introduction|conclusion|references)\s*[-—–:]\s*(.+)$/iu);
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

  const mathSymbols = (text.match(/[=∑∫√≤≥≈≠±×÷→←+\-*/^_{}[\]()]/gu) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return mathSymbols >= 3 && mathSymbols >= letters * 0.35;
}

function joinParagraphLines(lines: string[]): string {
  return lines.reduce((paragraph, line) => {
    if (!paragraph) {
      return line.trim();
    }

    if (/[-\u00ad\u2010-\u2015]$/u.test(paragraph)) {
      return paragraph.replace(/[-\u00ad\u2010-\u2015]$/u, '') + line.trim();
    }

    return `${paragraph} ${line.trim()}`;
  }, '');
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

function looksLikeFrontMatterTitle(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const titleCaseWords = words.filter((word) => /^\p{Lu}[\p{Ll}\p{L}\p{N}]*$/u.test(word)).length;
  return words.length <= 12 && titleCaseWords >= Math.max(3, Math.floor(words.length * 0.45));
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
