import { describe, expect, it } from 'vitest';
import {
  resolveDisplayedPdf,
  resolveParallelTranslationPdf,
  type PdfState
} from './usePdfSession';

function makePdf(fileName: string): PdfState {
  return {
    fileName,
    filePath: `C:/papers/${fileName}`,
    data: new Uint8Array([1, 2, 3])
  };
}

describe('usePdfSession helpers', () => {
  it('selects translated pdf only in translated mode', () => {
    const source = makePdf('source.pdf');
    const translated = makePdf('translated.pdf');

    expect(resolveDisplayedPdf('source', source, translated)).toBe(source);
    expect(resolveDisplayedPdf('translated', source, translated)).toBe(translated);
    expect(resolveDisplayedPdf('translated', source, null)).toBe(source);
  });

  it('prefers mono translation for parallel mode fallback', () => {
    const translated = makePdf('translated.pdf');
    const mono = makePdf('mono.pdf');

    expect(resolveParallelTranslationPdf(mono, translated)).toBe(mono);
    expect(resolveParallelTranslationPdf(null, translated)).toBe(translated);
  });
});
