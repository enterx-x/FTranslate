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

interface TextLine {
  text: string;
  x: number;
  y: number;
  height: number;
}

const COLUMN_SPLIT_THRESHOLD = 220;
const PARAGRAPH_GAP_THRESHOLD = 24;

export function buildPdfPageOutline(page: number, items: PositionedPdfTextItem[]): ExtractedPdfBlock[] {
  const lines = buildLines(items);
  const orderedLines = orderLinesForAcademicLayout(lines);
  const blocks: ExtractedPdfBlock[] = [];
  let currentParagraph: TextLine[] = [];
  let currentSection = `Page ${page}`;

  function flushParagraph(): void {
    if (currentParagraph.length === 0) {
      return;
    }

    const original = joinParagraphLines(currentParagraph.map((line) => line.text));
    blocks.push(createBlock(page, 'paragraph', currentSection, original));
    currentParagraph = [];
  }

  orderedLines.forEach((line) => {
    const type = classifyLine(line.text);

    if (type !== 'paragraph') {
      flushParagraph();
      const block = createBlock(page, type, type === 'heading' ? line.text.trim() : currentSection, line.text.trim());
      blocks.push(block);
      if (type === 'heading') {
        currentSection = line.text.trim();
      }
      return;
    }

    const previousLine = currentParagraph.at(-1);
    if (
      previousLine &&
      (Math.abs(line.y - previousLine.y) > PARAGRAPH_GAP_THRESHOLD ||
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

function buildLines(items: PositionedPdfTextItem[]): TextLine[] {
  const sortedItems = items
    .filter((item) => item.str.trim())
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const lines: Array<PositionedPdfTextItem[]> = [];

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
    const segments: Array<PositionedPdfTextItem[]> = [];

    orderedItems.forEach((item) => {
      const currentSegment = segments.at(-1);
      const previousItem = currentSegment?.at(-1);
      const horizontalGap = previousItem ? item.x - (previousItem.x + previousItem.width) : 0;

      if (!currentSegment || horizontalGap > 100) {
        segments.push([item]);
      } else {
        currentSegment.push(item);
      }
    });

    return segments.map((segmentItems) => ({
      text: segmentItems.map((item) => item.str.trim()).join(' ').replace(/\s+/g, ' ').trim(),
      x: Math.min(...segmentItems.map((item) => item.x)),
      y: segmentItems.reduce((sum, item) => sum + item.y, 0) / segmentItems.length,
      height: Math.max(...segmentItems.map((item) => item.height))
    }));
  });
}

function orderLinesForAcademicLayout(lines: TextLine[]): TextLine[] {
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
