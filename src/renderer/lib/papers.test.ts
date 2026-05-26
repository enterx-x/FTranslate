import { describe, expect, it } from 'vitest';
import { buildPaperRecord, updatePaperRecord, upsertPaperRecord } from './papers';
import { parseTranslationFile } from './translation';

describe('paper library metadata', () => {
  it('prefills paper metadata from Markdown header lines and removes them from paragraphs', () => {
    const content = [
      '中文标题：机器人基础模型 π0.7',
      '英文标题：A Robotic Foundation Model',
      '期刊：arXiv',
      '作者：Author A, Author B',
      '年份：2025',
      '',
      '摘要',
      '',
      '我们提出一种新的机器人基础模型。'
    ].join('\n');

    const document = parseTranslationFile(content, 'translation.md', 'D:/translation.md');
    const record = buildPaperRecord({
      pdfPath: 'D:/paper.pdf',
      pdfName: 'paper.pdf',
      translationPath: 'D:/translation.md',
      translationName: 'translation.md',
      document,
      now: '2026-05-26T10:00:00.000Z'
    });

    expect(record.chineseTitle).toBe('机器人基础模型 π0.7');
    expect(record.englishTitle).toBe('A Robotic Foundation Model');
    expect(record.journal).toBe('arXiv');
    expect(record.authors).toBe('Author A, Author B');
    expect(record.year).toBe('2025');
    expect(document.items[0].translation).toBe('摘要');
  });

  it('uses the first Markdown paragraph and PDF file name when metadata is missing', () => {
    const document = parseTranslationFile(
      '第一段中文译文用于生成标题，内容足够长但不应该超过四十个字符。\n\n第二段中文译文。',
      'translation.txt',
      'D:/translation.txt'
    );

    const record = buildPaperRecord({
      pdfPath: 'D:/A-Robotic-Foundation-Model.pdf',
      pdfName: 'A-Robotic-Foundation-Model.pdf',
      translationPath: 'D:/translation.txt',
      translationName: 'translation.txt',
      document,
      now: '2026-05-26T10:00:00.000Z'
    });

    expect(record.chineseTitle).toBe('第一段中文译文用于生成标题，内容足够长但不应该超过四十个字符。');
    expect(record.englishTitle).toBe('A-Robotic-Foundation-Model');
    expect(record.journal).toBe('');
    expect(record.authors).toBe('');
    expect(record.year).toBe('');
  });

  it('upserts records by pdf and translation path while preserving edited metadata', () => {
    const document = parseTranslationFile('中文译文。', 'translation.md', 'D:/translation.md');
    const first = buildPaperRecord({
      pdfPath: 'D:/paper.pdf',
      pdfName: 'paper.pdf',
      translationPath: 'D:/translation.md',
      translationName: 'translation.md',
      document,
      now: '2026-05-26T10:00:00.000Z'
    });
    const edited = updatePaperRecord(first, {
      chineseTitle: '手动修改后的标题',
      journal: 'Science Robotics',
      lastPage: 7
    });
    const incoming = buildPaperRecord({
      pdfPath: 'D:/paper.pdf',
      pdfName: 'paper.pdf',
      translationPath: 'D:/translation.md',
      translationName: 'translation.md',
      document,
      now: '2026-05-26T11:00:00.000Z'
    });

    const nextLibrary = upsertPaperRecord([edited], incoming);

    expect(nextLibrary).toHaveLength(1);
    expect(nextLibrary[0].chineseTitle).toBe('手动修改后的标题');
    expect(nextLibrary[0].journal).toBe('Science Robotics');
    expect(nextLibrary[0].lastPage).toBe(7);
    expect(nextLibrary[0].lastOpenedAt).toBe('2026-05-26T11:00:00.000Z');
  });
});
