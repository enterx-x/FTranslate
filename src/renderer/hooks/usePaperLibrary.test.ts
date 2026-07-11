import { describe, expect, it } from 'vitest';
import {
  createPaperLibraryState,
  markPaperLibraryChanged,
  removePaperFromLibrary,
  removePapersFromLibrary,
  replacePaperInLibrary,
  replacePapersInLibrary
} from './usePaperLibrary';
import type { PaperRecord } from '../lib/papers';

function makePaper(id: string, overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id,
    pdfPath: `C:/papers/${id}.pdf`,
    pdfName: `${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: id,
    englishTitle: id,
    journal: '',
    authors: '',
    year: '',
    notes: '',
    lastOpenedAt: '',
    lastPage: 1,
    tags: [],
    isPinned: false,
    importedAt: '',
    updatedAt: '',
    ...overrides
  };
}

describe('usePaperLibrary helpers', () => {
  it('replaces only the matching paper record', () => {
    const first = makePaper('first');
    const second = makePaper('second');
    const updated = { ...second, chineseTitle: '更新后的标题' };

    expect(replacePaperInLibrary([first, second], updated)).toEqual([first, updated]);
  });

  it('removes the selected paper record', () => {
    const first = makePaper('first');
    const second = makePaper('second');

    expect(removePaperFromLibrary([first, second], second)).toEqual([first]);
  });

  it('replaces a batch by id without reordering untouched papers', () => {
    const source = [makePaper('a'), makePaper('b'), makePaper('c')];
    const next = replacePapersInLibrary(source, [
      makePaper('b', { tags: ['CBF'] }),
      makePaper('a', { isPinned: true })
    ]);

    expect(next.map((paper) => paper.id)).toEqual(['a', 'b', 'c']);
    expect(next[0].isPinned).toBe(true);
    expect(next[1].tags).toEqual(['CBF']);
    expect(next[2]).toBe(source[2]);
  });

  it('removes a batch of ids without touching unrelated records', () => {
    const source = [makePaper('a'), makePaper('b'), makePaper('c')];

    expect(removePapersFromLibrary(source, ['a', 'c']).map((paper) => paper.id)).toEqual(['b']);
  });

  it('protects malformed source storage until the user changes the library', () => {
    const snapshot = createPaperLibraryState('{broken');

    expect(snapshot).toEqual({
      papers: [],
      persistenceBlocked: true,
      warning: '论文库本地数据无法解析，已保留原始内容。'
    });
    expect(markPaperLibraryChanged(snapshot)).toEqual({
      ...snapshot,
      persistenceBlocked: false
    });
  });
});
