import { describe, expect, it } from 'vitest';
import { removePaperFromLibrary, replacePaperInLibrary } from './usePaperLibrary';
import type { PaperRecord } from '../lib/papers';

function makePaper(id: string, title = id): PaperRecord {
  return {
    id,
    pdfPath: `C:/papers/${id}.pdf`,
    pdfName: `${id}.pdf`,
    translationPath: '',
    translationName: '',
    chineseTitle: title,
    englishTitle: id,
    journal: '',
    authors: '',
    year: '',
    notes: '',
    lastOpenedAt: '',
    lastPage: 1
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
});
