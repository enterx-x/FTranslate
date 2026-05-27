import type { TranslationItem } from './translation';

const JSON_SCHEMA_TEXT = [
  '请把下面的英文学术论文段落翻译成中文，并只输出 JSON 数组。',
  '数组每一项必须包含 section、original、translation 三个字段。',
  '如果原文包含数学表达式，请在 translation 中保留 LaTeX 定界符：行内公式使用 $...$，独立公式使用 $$...$$。',
  '不要使用 Markdown 代码块，不要输出解释文字，不要省略 original。'
].join('\n');

export function buildCurrentJsonPrompt(item: TranslationItem | null): string {
  if (!item || !item.original.trim()) {
    return buildMissingSourcePrompt();
  }

  return [
    JSON_SCHEMA_TEXT,
    '',
    '请按下面这个单段数组格式返回：',
    JSON.stringify(
      [
        {
          section: item.section || 'Untitled',
          original: item.original,
          translation: ''
        }
      ],
      null,
      2
    )
  ].join('\n');
}

export function buildFullJsonPrompt(items: TranslationItem[]): string {
  const sourceItems = items
    .filter((item) => item.original.trim())
    .map((item) => ({
      section: item.section || 'Untitled',
      original: item.original,
      translation: ''
    }));

  if (sourceItems.length === 0) {
    return buildMissingSourcePrompt();
  }

  return [
    JSON_SCHEMA_TEXT,
    '',
    '请保持数组顺序逐段翻译：',
    JSON.stringify(sourceItems, null, 2)
  ].join('\n');
}

function buildMissingSourcePrompt(): string {
  return [
    JSON_SCHEMA_TEXT,
    '',
    '请先把英文原文段落粘贴到这里，然后让 AI 按上述 JSON schema 返回结果。'
  ].join('\n');
}
