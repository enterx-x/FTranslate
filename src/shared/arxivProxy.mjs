const SORT_BY_VALUES = new Set(['relevance', 'lastUpdatedDate', 'submittedDate']);
const SORT_ORDER_VALUES = new Set(['ascending', 'descending']);

export function buildArxivProxyUpstreamUrl(query) {
  const searchQuery = readSingleValue(query.search_query).trim();
  if (!searchQuery || searchQuery.length > 800) {
    throw new Error('search_query 必须为 1 到 800 个字符。');
  }

  const start = readBoundedInteger(query.start, 0, 2_000, 0, 'start');
  const maxResults = readBoundedInteger(query.max_results, 1, 50, 20, 'max_results');
  const sortBy = readEnum(query.sortBy, SORT_BY_VALUES, 'submittedDate', 'sortBy');
  const sortOrder = readEnum(query.sortOrder, SORT_ORDER_VALUES, 'descending', 'sortOrder');

  const upstream = new URL('https://export.arxiv.org/api/query');
  upstream.searchParams.set('search_query', searchQuery);
  upstream.searchParams.set('start', String(start));
  upstream.searchParams.set('max_results', String(maxResults));
  upstream.searchParams.set('sortBy', sortBy);
  upstream.searchParams.set('sortOrder', sortOrder);
  return upstream.toString();
}

export function buildArxivHtmlFallbackUrl(query) {
  const fallbackQuery = readFallbackQuery(query);
  if (!fallbackQuery || fallbackQuery.length > 300) {
    throw new Error('fallback_query 必须为 1 到 300 个字符。');
  }
  const sortBy = readEnum(query.sortBy, SORT_BY_VALUES, 'submittedDate', 'sortBy');
  const sortOrder = readEnum(query.sortOrder, SORT_ORDER_VALUES, 'descending', 'sortOrder');
  const start = readBoundedInteger(query.start, 0, 2_000, 0, 'start');
  const order = toHtmlSearchOrder(sortBy, sortOrder);
  const category = readArxivFallbackCategory(query);
  const archive = toHtmlArchive(category);
  const url = new URL(archive ? 'https://arxiv.org/search/advanced' : 'https://arxiv.org/search/');
  if (archive) {
    url.searchParams.set('advanced', '');
    url.searchParams.set('terms-0-operator', 'AND');
    url.searchParams.set('terms-0-term', fallbackQuery);
    url.searchParams.set('terms-0-field', 'all');
    url.searchParams.set(`classification-${archive}`, 'y');
    url.searchParams.set('classification-include_cross_list', 'include');
    url.searchParams.set('date-filter_by', 'all_dates');
    url.searchParams.set('date-date_type', 'submitted_date');
  } else {
    url.searchParams.set('query', fallbackQuery);
    url.searchParams.set('searchtype', 'all');
  }
  url.searchParams.set('abstracts', 'show');
  url.searchParams.set('order', order);
  url.searchParams.set('size', '25');
  if (start > 0) {
    url.searchParams.set('start', String(start));
  }
  return url.toString();
}

export function readArxivFallbackCategory(query) {
  const explicit = readSingleValue(query.fallback_category).trim();
  const inferred = readSingleValue(query.search_query).match(/cat:([a-z0-9.-]+)/iu)?.[1] ?? '';
  const category = explicit || inferred;
  return /^[a-z0-9.-]{1,32}$/iu.test(category) ? category : '';
}

export function convertArxivSearchHtmlToAtom(html, options = {}) {
  const categoryFilter = options.category ?? '';
  const maxResults = Number.isFinite(options.maxResults) ? Math.max(1, Math.trunc(options.maxResults)) : 25;
  const entries = Array.from(html.matchAll(/<li\s+class="arxiv-result"[^>]*>([\s\S]*?)<\/li>/giu))
    .map((match) => parseHtmlResult(match[1]))
    .filter((entry) => entry && (!categoryFilter || entry.categories.includes(categoryFilter)))
    .slice(0, maxResults);
  const totalMatch = html.match(/of\s+([\d,]+)\s+results/iu);
  const totalResults = categoryFilter
    ? entries.length
    : totalMatch ? Number(totalMatch[1].replace(/,/gu, '')) : entries.length;
  const start = Number.isFinite(options.start) ? Math.max(0, Math.trunc(options.start)) : 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>${Number.isFinite(totalResults) ? totalResults : entries.length}</opensearch:totalResults>
  <opensearch:startIndex>${start}</opensearch:startIndex>
  <opensearch:itemsPerPage>${entries.length}</opensearch:itemsPerPage>
  ${entries.map(renderAtomEntry).join('\n  ')}
</feed>`;
}

function parseHtmlResult(item) {
  const idMatch = item.match(/href="https:\/\/arxiv\.org\/abs\/([^"?#]+)"/iu);
  if (!idMatch) {
    return null;
  }
  const arxivId = decodeHtml(idMatch[1]);
  const title = extractClassText(item, 'p', 'title');
  if (!title) {
    return null;
  }
  const authorsBlock = extractClassHtml(item, 'p', 'authors');
  const authors = Array.from(authorsBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/giu))
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
  const categories = Array.from(item.matchAll(/<span[^>]*class="[^"]*\btag\b[^"]*"[^>]*>([\s\S]*?)<\/span>/giu))
    .map((match) => stripHtml(match[1]))
    .filter((value) => /^[a-z-]+\.[A-Z-]+$/u.test(value));
  const abstractHtml = extractClassHtml(item, 'span', 'abstract-full') || extractClassHtml(item, 'span', 'abstract-short');
  const summary = stripHtml(abstractHtml).replace(/[△▽]\s*(?:Less|More)\s*$/iu, '').trim();
  const submitted = item.match(/Submitted<\/span>\s*([^;<]+)/iu)?.[1]?.trim() ?? '';
  const published = toIsoDate(submitted);
  const pdfPath = item.match(/href="https:\/\/arxiv\.org\/pdf\/([^"?#]+)"/iu)?.[1] ?? arxivId;
  return {
    id: `https://arxiv.org/abs/${arxivId}`,
    title,
    authors,
    summary,
    published,
    categories,
    pdfUrl: `https://arxiv.org/pdf/${decodeHtml(pdfPath)}`
  };
}

function renderAtomEntry(entry) {
  const primaryCategory = entry.categories[0] ?? '';
  return `<entry>
    <id>${escapeXml(entry.id)}</id>
    <updated>${escapeXml(entry.published)}</updated>
    <published>${escapeXml(entry.published)}</published>
    <title>${escapeXml(entry.title)}</title>
    <summary>${escapeXml(entry.summary)}</summary>
    ${entry.authors.map((author) => `<author><name>${escapeXml(author)}</name></author>`).join('')}
    ${entry.categories.map((category) => `<category term="${escapeXml(category)}" />`).join('')}
    ${primaryCategory ? `<arxiv:primary_category term="${escapeXml(primaryCategory)}" />` : ''}
    <link href="${escapeXml(entry.id)}" rel="alternate" type="text/html" />
    <link href="${escapeXml(entry.pdfUrl)}" rel="related" type="application/pdf" title="pdf" />
  </entry>`;
}

function extractClassHtml(value, tagName, className) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*class="([^"]*)"[^>]*>`, 'giu');
  for (const match of value.matchAll(pattern)) {
    if (match[1].split(/\s+/u).includes(className)) {
      const contentStart = (match.index ?? 0) + match[0].length;
      const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'giu');
      tagPattern.lastIndex = contentStart;
      let depth = 1;
      for (const tagMatch of value.matchAll(tagPattern)) {
        depth += tagMatch[0].startsWith('</') ? -1 : 1;
        if (depth === 0) {
          return value.slice(contentStart, tagMatch.index);
        }
      }
      return '';
    }
  }
  return '';
}

function extractClassText(value, tagName, className) {
  return stripHtml(extractClassHtml(value, tagName, className));
}

function stripHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').replace(/\s+([.,;:!?])/gu, '$1').trim());
}

function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code) => {
    if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLowerCase()] ?? entity;
  });
}

function escapeXml(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

function toIsoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '1970-01-01T00:00:00.000Z';
}

function readFallbackQuery(query) {
  const explicit = readSingleValue(query.fallback_query).trim();
  if (explicit) {
    return explicit;
  }
  return readSingleValue(query.search_query)
    .replace(/\b(?:ti|abs|all|cat):/giu, ' ')
    .replace(/\b(?:AND|OR|NOT)\b/gu, ' ')
    .replace(/[()"\\]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function toHtmlSearchOrder(sortBy, sortOrder) {
  if (sortBy === 'relevance') {
    return '';
  }
  const base = sortBy === 'submittedDate' ? 'submitted_date' : 'announced_date_first';
  return sortOrder === 'descending' ? `-${base}` : base;
}

function toHtmlArchive(category) {
  const prefix = category.split('.')[0]?.toLowerCase();
  return {
    cs: 'computer_science',
    econ: 'economics',
    eess: 'eess',
    math: 'mathematics'
  }[prefix] ?? '';
}

function readSingleValue(value) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function readBoundedInteger(value, minimum, maximum, fallback, label) {
  const raw = readSingleValue(value).trim();
  if (!raw) {
    return fallback;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${label} 必须为整数。`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} 必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return parsed;
}

function readEnum(value, allowed, fallback, label) {
  const raw = readSingleValue(value).trim() || fallback;
  if (!allowed.has(raw)) {
    throw new Error(`${label} 参数无效。`);
  }
  return raw;
}
