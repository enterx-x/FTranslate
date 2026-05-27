import katex from 'katex';

interface MathSegment {
  kind: 'text' | 'math';
  value: string;
  display?: boolean;
}

const MATH_DELIMITERS = [
  { open: '$$', close: '$$', display: true },
  { open: '\\[', close: '\\]', display: true },
  { open: '\\(', close: '\\)', display: false },
  { open: '$', close: '$', display: false }
] as const;

export function renderMathTextToHtml(text: string): string {
  return parseMathText(text)
    .map((segment) => {
      if (segment.kind === 'text') {
        return renderEscapedText(segment.value);
      }

      try {
        return katex.renderToString(segment.value, {
          displayMode: Boolean(segment.display),
          throwOnError: false,
          strict: false,
          trust: false,
          output: 'html'
        });
      } catch {
        return renderEscapedText(segment.value);
      }
    })
    .join('');
}

export function parseMathText(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const next = findNextDelimiter(text, cursor);
    if (!next) {
      segments.push({ kind: 'text', value: text.slice(cursor) });
      break;
    }

    if (next.index > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, next.index) });
    }

    const start = next.index + next.delimiter.open.length;
    const end = text.indexOf(next.delimiter.close, start);
    if (end === -1) {
      segments.push({ kind: 'text', value: text.slice(next.index) });
      break;
    }

    const value = text.slice(start, end).trim();
    segments.push(
      value
        ? { kind: 'math', value, display: next.delimiter.display }
        : { kind: 'text', value: text.slice(next.index, end + next.delimiter.close.length) }
    );
    cursor = end + next.delimiter.close.length;
  }

  return segments;
}

function findNextDelimiter(text: string, fromIndex: number): {
  index: number;
  delimiter: (typeof MATH_DELIMITERS)[number];
} | null {
  let match: { index: number; delimiter: (typeof MATH_DELIMITERS)[number] } | null = null;

  MATH_DELIMITERS.forEach((delimiter) => {
    const index = text.indexOf(delimiter.open, fromIndex);
    if (index === -1) {
      return;
    }

    if (!match || index < match.index || (index === match.index && delimiter.open.length > match.delimiter.open.length)) {
      match = { index, delimiter };
    }
  });

  return match;
}

function renderEscapedText(text: string): string {
  return escapeHtml(text)
    .replace(/\r\n|\r|\n/gu, '<br />');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}
