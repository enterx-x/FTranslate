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

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
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
    .replace(/\*([^*]+)\*/gu, '<em>$1</em>')
    .replace(/_([^_]+)_/gu, '<em>$1</em>');
}
