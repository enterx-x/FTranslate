import { renderMathTextToHtml } from './mathText';

export function renderMarkdownDocumentToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/gu, '\n').trim();
  if (!normalized) {
    return '<p class="document-empty">暂无内容</p>';
  }

  const lines = normalized.split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let unorderedList: string[] = [];
  let orderedList: string[] = [];
  let quote: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  }

  function flushUnorderedList(): void {
    if (unorderedList.length === 0) return;
    html.push(`<ul>${unorderedList.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    unorderedList = [];
  }

  function flushOrderedList(): void {
    if (orderedList.length === 0) return;
    html.push(`<ol>${orderedList.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ol>`);
    orderedList = [];
  }

  function flushQuote(): void {
    if (quote.length === 0) return;
    html.push(`<blockquote>${quote.map((item) => `<p>${renderInlineMarkdown(item)}</p>`).join('')}</blockquote>`);
    quote = [];
  }

  function flushAll(): void {
    flushParagraph();
    flushUnorderedList();
    flushOrderedList();
    flushQuote();
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }

    if (isMarkdownTableHeader(lines, lineIndex)) {
      flushAll();
      const headerLine = trimmed;
      lineIndex += 2;
      const bodyRows: string[] = [];
      while (lineIndex < lines.length && isMarkdownTableRow(lines[lineIndex])) {
        bodyRows.push(lines[lineIndex].trim());
        lineIndex += 1;
      }
      lineIndex -= 1;
      html.push(renderMarkdownTable(headerLine, bodyRows));
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/u);
    if (heading) {
      flushAll();
      const level = Math.min(4, heading[1].length + 1);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/u);
    if (unordered) {
      flushParagraph();
      flushOrderedList();
      flushQuote();
      unorderedList.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/u);
    if (ordered) {
      flushParagraph();
      flushUnorderedList();
      flushQuote();
      orderedList.push(ordered[1]);
      continue;
    }

    const quoted = trimmed.match(/^>\s?(.+)$/u);
    if (quoted) {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();
      quote.push(quoted[1]);
      continue;
    }

    flushUnorderedList();
    flushOrderedList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return html.join('');
}

export function renderInlineMarkdown(value: string): string {
  return renderMathTextToHtml(value)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/__([^_]+)__/gu, '<strong>$1</strong>')
    .replace(/(^|[\s([{])\*([^*\s][^*]*?)\*(?=$|[\s)\]}.,;:!?，。；：！？、])/gu, '$1<em>$2</em>')
    .replace(/(^|[\s([{])_([^_\s][^_]*?)_(?=$|[\s)\]}.,;:!?，。；：！？、])/gu, '$1<em>$2</em>');
}

function isMarkdownTableHeader(lines: string[], index: number): boolean {
  return isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1] ?? '');
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && splitMarkdownTableRow(trimmed).length >= 2;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line.trim());
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function renderMarkdownTable(headerLine: string, bodyRows: string[]): string {
  const headers = splitMarkdownTableRow(headerLine);
  const rows = bodyRows.map(splitMarkdownTableRow);
  return [
    '<table>',
    `<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`,
    `<tbody>${rows
      .map(
        (row) =>
          `<tr>${headers.map((_, index) => `<td>${renderInlineMarkdown(row[index] ?? '')}</td>`).join('')}</tr>`
      )
      .join('')}</tbody>`,
    '</table>'
  ].join('');
}
