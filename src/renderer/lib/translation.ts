export type TranslationFileKind = 'json' | 'markdown';

export interface TranslationItem {
  id?: string;
  section: string;
  original: string;
  translation: string;
  type?: 'heading' | 'paragraph' | 'formula' | 'caption';
  page?: number;
  sourceHash?: string;
  translatedAt?: string;
  provider?: string;
  model?: string;
}

export interface TranslationMetadata {
  chineseTitle?: string;
  englishTitle?: string;
  journal?: string;
  authors?: string;
  year?: string;
}

export interface TranslationDocument {
  kind: TranslationFileKind;
  items: TranslationItem[];
  metadata?: TranslationMetadata;
  sourcePath?: string;
  sourceName?: string;
}

export function parseTranslationFile(
  content: string,
  fileName: string,
  sourcePath?: string
): TranslationDocument {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName.endsWith('.json')) {
    return parseJsonTranslation(content, sourcePath, fileName);
  }

  if (
    normalizedName.endsWith('.md') ||
    normalizedName.endsWith('.markdown') ||
    normalizedName.endsWith('.txt')
  ) {
    return parseMarkdownTranslation(content, sourcePath, fileName);
  }

  throw new Error('仅支持 JSON、Markdown 或 TXT 翻译文件。');
}

export function parseMarkdownTranslation(
  content: string,
  sourcePath?: string,
  sourceName?: string
): TranslationDocument {
  const { body, metadata } = stripMarkdownMetadata(content);

  // Markdown 翻译稿只存中文段落；这里按一个或多个空行切分，保留段内换行。
  const paragraphs = body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return {
    kind: 'markdown',
    metadata,
    sourcePath,
    sourceName,
    items: paragraphs.map((paragraph, index) => ({
      section: `Markdown ${index + 1}`,
      original: '',
      translation: paragraph
    }))
  };
}

export function parseJsonTranslation(
  content: string,
  sourcePath?: string,
  sourceName?: string
): TranslationDocument {
  const parsed: unknown = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error('JSON 翻译文件必须是数组结构。');
  }

  const items = parsed.map((item, index): TranslationItem => {
    if (!item || typeof item !== 'object') {
      throw new Error(`JSON 第 ${index + 1} 项必须是对象。`);
    }

    const record = item as Record<string, unknown>;

    return {
      id: toText(record.id) || undefined,
      section: toText(record.section, `Section ${index + 1}`),
      original: toText(record.original),
      translation: toText(record.translation),
      type: parseTranslationItemType(record.type),
      page: typeof record.page === 'number' ? record.page : undefined,
      sourceHash: toText(record.sourceHash) || undefined,
      translatedAt: toText(record.translatedAt) || undefined,
      provider: toText(record.provider) || undefined,
      model: toText(record.model) || undefined
    };
  });

  return {
    kind: 'json',
    metadata: inferJsonMetadata(items),
    sourcePath,
    sourceName,
    items
  };
}

export function updateTranslationAtIndex(
  document: TranslationDocument,
  index: number,
  nextTranslation: string
): TranslationDocument {
  if (index < 0 || index >= document.items.length) {
    throw new Error('段落索引超出范围。');
  }

  return {
    ...document,
    items: document.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, translation: nextTranslation } : item
    )
  };
}

export function serializeTranslationDocument(document: TranslationDocument): string {
  if (document.kind === 'json') {
    return `${JSON.stringify(document.items, null, 2)}\n`;
  }

  // Markdown 文件保存时继续使用空行分隔，避免意外改成 JSON 格式。
  const metadataHeader = serializeMarkdownMetadata(document.metadata);
  return `${metadataHeader}${document.items.map((item) => item.translation.trim()).join('\n\n')}\n`;
}

export function exportBilingualMarkdown(document: TranslationDocument): string {
  if (document.kind !== 'json') {
    throw new Error('只有 JSON 翻译文件可以导出双语 Markdown。');
  }

  return document.items
    .map((item) =>
      [
        `## ${item.section || 'Untitled Section'}`,
        '',
        '**Original**',
        '',
        item.original,
        '',
        '**Translation**',
        '',
        item.translation
      ].join('\n')
    )
    .join('\n\n')
    .concat('\n');
}

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseTranslationItemType(value: unknown): TranslationItem['type'] {
  return value === 'heading' || value === 'paragraph' || value === 'formula' || value === 'caption'
    ? value
    : undefined;
}

function stripMarkdownMetadata(content: string): { body: string; metadata: TranslationMetadata } {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const metadata: TranslationMetadata = {};
  let index = 0;
  let foundMetadata = false;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      break;
    }

    const parsed = parseMetadataLine(line);
    if (!parsed) {
      break;
    }

    metadata[parsed.key] = parsed.value;
    foundMetadata = true;
    index += 1;
  }

  if (!foundMetadata) {
    return { body: normalized, metadata };
  }

  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }

  return {
    body: lines.slice(index).join('\n'),
    metadata
  };
}

function parseMetadataLine(
  line: string
): { key: keyof TranslationMetadata; value: string } | null {
  const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
  if (!match) {
    return null;
  }

  const label = match[1].trim().toLowerCase();
  const value = match[2].trim();
  const key = metadataLabelMap[label];

  if (!key) {
    return null;
  }

  return { key, value };
}

const metadataLabelMap: Record<string, keyof TranslationMetadata> = {
  中文标题: 'chineseTitle',
  chineseTitle: 'chineseTitle',
  chinese_title: 'chineseTitle',
  英文标题: 'englishTitle',
  englishTitle: 'englishTitle',
  english_title: 'englishTitle',
  title: 'englishTitle',
  期刊: 'journal',
  journal: 'journal',
  venue: 'journal',
  作者: 'authors',
  authors: 'authors',
  author: 'authors',
  年份: 'year',
  year: 'year'
};

function serializeMarkdownMetadata(metadata?: TranslationMetadata): string {
  if (!metadata || Object.values(metadata).every((value) => !value)) {
    return '';
  }

  const lines = [
    ['中文标题', metadata.chineseTitle],
    ['英文标题', metadata.englishTitle],
    ['期刊', metadata.journal],
    ['作者', metadata.authors],
    ['年份', metadata.year]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`);

  return `${lines.join('\n')}\n\n`;
}

function inferJsonMetadata(items: TranslationItem[]): TranslationMetadata {
  const first = items[0];
  if (!first) {
    return {};
  }

  return {
    chineseTitle: truncateText(first.translation, 40),
    englishTitle: truncateText(first.original, 80)
  };
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}
