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
  it('prefers the Chinese-only PDF in translated mode', () => {
    const source = makePdf('source.pdf');
    const translated = makePdf('translated.pdf');
    const mono = makePdf('mono.pdf');

    expect(resolveDisplayedPdf('source', source, translated, mono)).toBe(source);
    expect(resolveDisplayedPdf('translated', source, translated, mono)).toBe(mono);
    expect(resolveDisplayedPdf('translated', source, translated, null)).toBeNull();
    expect(resolveDisplayedPdf('translated', source, null, null)).toBeNull();
  });

  it('requires a Chinese-only PDF for parallel mode', () => {
    const translated = makePdf('translated.pdf');
    const mono = makePdf('mono.pdf');

    expect(resolveParallelTranslationPdf(mono, translated)).toBe(mono);
    expect(resolveParallelTranslationPdf(null, translated)).toBeNull();
  });
});
