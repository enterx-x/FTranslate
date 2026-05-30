import { describe, expect, it } from 'vitest';
import {
  buildPaperRecord,
  parsePaperLibrary,
  updatePaperRecord,
  upsertPaperRecord
} from './papers';
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

  it('loads PDF-only records so whole-document PDF translation can start without JSON or Markdown', () => {
    const parsed = parsePaperLibrary(
      JSON.stringify([
        {
          id: 'paper-only-1',
          pdfPath: 'D:/paper.pdf',
          pdfName: 'paper.pdf',
          translationPath: '',
          translationName: '',
          chineseTitle: '',
          englishTitle: 'paper',
          journal: '',
          authors: '',
          year: '',
          notes: '',
          lastOpenedAt: '2026-05-28T10:00:00.000Z',
          lastPage: 1
        }
      ])
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].pdfPath).toBe('D:/paper.pdf');
    expect(parsed[0].translationPath).toBe('');
  });

  it('restores missing legacy file names from paths without dropping extensions', () => {
    const parsed = parsePaperLibrary(
      JSON.stringify([
        {
          id: 'paper-legacy-1',
          pdfPath: 'D:/papers/robot.paper.v2.pdf',
          translationPath: 'D:/translations/robot.paper.v2.dual.json',
          chineseTitle: '',
          englishTitle: '',
          journal: '',
          authors: '',
          year: '',
          notes: '',
          lastOpenedAt: '2026-05-29T10:00:00.000Z',
          lastPage: 1
        }
      ])
    );

    expect(parsed[0].pdfName).toBe('robot.paper.v2.pdf');
    expect(parsed[0].translationName).toBe('robot.paper.v2.dual.json');
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

  it('persists AI cache paths and paper notes in the paper library', () => {
    const parsed = parsePaperLibrary(
      JSON.stringify([
        {
          id: 'paper-1',
          pdfPath: 'D:/paper.pdf',
          pdfName: 'paper.pdf',
          translationPath: 'D:/translation.md',
          translationName: 'translation.md',
          aiCachePath: 'D:/paper-ai-cache.json',
          aiCacheName: 'paper-ai-cache.json',
          chineseTitle: '中文标题',
          englishTitle: 'English Title',
          journal: 'arXiv',
          authors: 'Author A',
          year: '2026',
          notes: '这里是阅读笔记。',
          lastOpenedAt: '2026-05-27T10:00:00.000Z',
          lastPage: 3
        }
      ])
    );

    expect(parsed[0].aiCachePath).toBe('D:/paper-ai-cache.json');
    expect(parsed[0].aiCacheName).toBe('paper-ai-cache.json');
    expect(parsed[0].notes).toBe('这里是阅读笔记。');

    const updated = updatePaperRecord(parsed[0], {
      aiCachePath: 'D:/new-cache.json',
      aiCacheName: 'new-cache.json',
      notes: '新的阅读笔记。'
    });

    expect(updated.aiCachePath).toBe('D:/new-cache.json');
    expect(updated.aiCacheName).toBe('new-cache.json');
    expect(updated.notes).toBe('新的阅读笔记。');
  });

  it('persists generated bilingual PDF metadata without losing legacy translation paths', () => {
    const parsed = parsePaperLibrary(
      JSON.stringify([
        {
          id: 'paper-1',
          pdfPath: 'D:/paper.pdf',
          pdfName: 'paper.pdf',
          translationPath: 'D:/translation.md',
          translationName: 'translation.md',
          aiCachePath: 'D:/paper-ai-cache.json',
          aiCacheName: 'paper-ai-cache.json',
          translatedPdfPath: 'C:/Users/me/AppData/Roaming/PDF Translation Reader/translations/paper-1/paper-dual.pdf',
          translatedPdfName: 'paper-dual.pdf',
          translatedPdfMode: 'dual',
          translationEngine: 'pdfmathtranslate',
          translationSourceHash: 'hash-1',
          translatedAt: '2026-05-28T08:00:00.000Z',
          translatedProvider: 'kimi',
          translatedModel: 'kimi-k2.5',
          chineseTitle: '中文标题',
          englishTitle: 'English Title',
          journal: 'arXiv',
          authors: 'Author A',
          year: '2026',
          notes: '这里是阅读笔记。',
          lastOpenedAt: '2026-05-28T10:00:00.000Z',
          lastPage: 4
        }
      ])
    );

    expect(parsed[0].translationPath).toBe('D:/translation.md');
    expect(parsed[0].aiCachePath).toBe('D:/paper-ai-cache.json');
    expect(parsed[0].translatedPdfPath).toContain('paper-dual.pdf');
    expect(parsed[0].translatedPdfMode).toBe('dual');
    expect(parsed[0].translationEngine).toBe('pdfmathtranslate');
    expect(parsed[0].translatedProvider).toBe('kimi');

    const updated = updatePaperRecord(parsed[0], {
      translatedPdfPath: 'D:/cache/new-paper-dual.pdf',
      translatedPdfName: 'new-paper-dual.pdf',
      translatedPdfMode: 'dual',
      translationEngine: 'pdfmathtranslate',
      translationSourceHash: 'hash-2',
      translatedAt: '2026-05-28T09:00:00.000Z',
      translatedProvider: 'openai',
      translatedModel: 'gpt-5.5'
    });

    expect(updated.translatedPdfPath).toBe('D:/cache/new-paper-dual.pdf');
    expect(updated.translationPath).toBe('D:/translation.md');
    expect(updated.translatedProvider).toBe('openai');
  });

  it('restores missing cache and translated PDF names from stored paths', () => {
    const parsed = parsePaperLibrary(
      JSON.stringify([
        {
          id: 'paper-legacy-assets-1',
          pdfPath: 'D:/paper.pdf',
          pdfName: 'paper.pdf',
          translationPath: 'D:/translation.md',
          translationName: 'translation.md',
          aiCachePath: 'D:/cache/paper-ai-cache.json',
          translatedPdfPath: 'D:/cache/paper.dual.version.pdf',
          translatedMonoPdfPath: 'D:/cache/paper.mono.version.pdf',
          chineseTitle: '中文标题',
          englishTitle: 'English Title',
          journal: '',
          authors: '',
          year: '',
          notes: '',
          lastOpenedAt: '2026-05-30T08:00:00.000Z',
          lastPage: 2
        }
      ])
    );

    expect(parsed[0].aiCacheName).toBe('paper-ai-cache.json');
    expect(parsed[0].translatedPdfName).toBe('paper.dual.version.pdf');
    expect(parsed[0].translatedMonoPdfName).toBe('paper.mono.version.pdf');
  });

  it('keeps paper records focused on metadata and ignores legacy spreadsheet cells', () => {
    const parsed = parsePaperLibrary(
      JSON.stringify([
        {
          id: 'paper-1',
          pdfPath: 'D:/paper.pdf',
          pdfName: 'paper.pdf',
          translationPath: 'D:/translation.md',
          translationName: 'translation.md',
          chineseTitle: '中文标题',
          englishTitle: 'English Title',
          journal: 'arXiv',
          authors: 'Author A',
          year: '2026',
          notes: '',
          sheetCells: {
            innovation: '提出 $L=\\sum_i x_i^2$ 约束。',
            limitations: '需要更多真实机器人实验。'
          },
          lastOpenedAt: '2026-05-27T10:00:00.000Z',
          lastPage: 3
        }
      ])
    );

    expect(parsed[0]).not.toHaveProperty('sheetCells');
    expect(parsed[0].chineseTitle).toBe('中文标题');
  });
});
