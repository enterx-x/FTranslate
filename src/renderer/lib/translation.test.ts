import { describe, expect, it } from 'vitest';
import {
  exportBilingualMarkdown,
  parseTranslationFile,
  serializeTranslationDocument,
  updateTranslationAtIndex
} from './translation';

describe('translation file parsing', () => {
  it('parses Markdown by blank-line separated paragraphs', () => {
    const document = parseTranslationFile('第一段中文。\n\n第二段中文。\n仍属于第二段。', 'paper.md');

    expect(document.kind).toBe('markdown');
    expect(document.items).toEqual([
      {
        section: 'Markdown 1',
        original: '',
        translation: '第一段中文。'
      },
      {
        section: 'Markdown 2',
        original: '',
        translation: '第二段中文。\n仍属于第二段。'
      }
    ]);
  });

  it('parses JSON array items with section, original, and translation fields', () => {
    const content = JSON.stringify([
      {
        section: 'Abstract',
        original: 'We present a new robotic foundation model.',
        translation: '我们提出一种新的机器人基础模型。'
      }
    ]);

    const document = parseTranslationFile(content, 'paper.json', 'D:/paper.json');

    expect(document.kind).toBe('json');
    expect(document.sourcePath).toBe('D:/paper.json');
    expect(document.items[0].section).toBe('Abstract');
    expect(document.items[0].original).toContain('robotic foundation model');
    expect(document.items[0].translation).toContain('机器人基础模型');
  });

  it('updates one JSON translation without mutating the original document', () => {
    const document = parseTranslationFile(
      JSON.stringify([
        {
          section: 'I. INTRODUCTION',
          original: 'Foundation models work on the principle.',
          translation: '旧译文'
        }
      ]),
      'paper.json'
    );

    const updated = updateTranslationAtIndex(document, 0, '新译文');

    expect(updated.items[0].translation).toBe('新译文');
    expect(document.items[0].translation).toBe('旧译文');
  });

  it('serializes JSON documents back to pretty JSON', () => {
    const document = parseTranslationFile(
      JSON.stringify([
        {
          section: 'Abstract',
          original: 'Original text',
          translation: '中文译文'
        }
      ]),
      'paper.json'
    );

    expect(serializeTranslationDocument(document)).toContain('"section": "Abstract"');
    expect(JSON.parse(serializeTranslationDocument(document))).toEqual(document.items);
  });

  it('exports JSON documents to bilingual Markdown', () => {
    const document = parseTranslationFile(
      JSON.stringify([
        {
          section: 'Abstract',
          original: 'Original text',
          translation: '中文译文'
        }
      ]),
      'paper.json'
    );

    expect(exportBilingualMarkdown(document)).toBe(
      '## Abstract\n\n**Original**\n\nOriginal text\n\n**Translation**\n\n中文译文\n'
    );
  });
});
