import { describe, expect, it } from 'vitest';
import {
  PDF_TRANSLATION_POSTPROCESS_SCRIPT,
  PDF_TRANSLATION_POSTPROCESS_VERSION,
  buildPdfTranslationPostprocessInvocation
} from './pdfTranslationPostprocess';

describe('PDF translation post-processing', () => {
  it('passes the source, mono and dual paths without shell interpolation', () => {
    const invocation = buildPdfTranslationPostprocessInvocation({
      sourcePdfPath: 'C:\\papers\\source paper.pdf',
      monoPdfPath: 'C:\\papers\\中文-mono.pdf',
      dualPdfPath: 'C:\\papers\\中文-dual.pdf'
    });

    expect(invocation.args).toEqual([
      '-c',
      PDF_TRANSLATION_POSTPROCESS_SCRIPT,
      'C:\\papers\\source paper.pdf',
      'C:\\papers\\中文-mono.pdf',
      'C:\\papers\\中文-dual.pdf'
    ]);
    expect(PDF_TRANSLATION_POSTPROCESS_VERSION).toMatch(/^preserve-source-xobjects-/u);
  });

  it('uses an empty positional argument when an output is absent', () => {
    const invocation = buildPdfTranslationPostprocessInvocation({
      sourcePdfPath: 'source.pdf',
      monoPdfPath: 'mono.pdf'
    });

    expect(invocation.args.slice(-3)).toEqual(['source.pdf', 'mono.pdf', '']);
  });
});
