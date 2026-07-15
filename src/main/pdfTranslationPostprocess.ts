export const PDF_TRANSLATION_POSTPROCESS_VERSION = 'preserve-source-xobjects-v1';

export interface PdfTranslationPostprocessRequest {
  sourcePdfPath: string;
  monoPdfPath?: string | null;
  dualPdfPath?: string | null;
}

export interface PdfTranslationPostprocessInvocation {
  args: string[];
}

/**
 * PDFMathTranslate can rewrite image/form XObjects and copy source-link annotations
 * onto reflowed Chinese pages. The former may corrupt colour spaces; the latter leaves
 * visible red/green boxes at coordinates that no longer match the translated text.
 *
 * This script restores page XObjects from the source PDF and removes only /Link
 * annotations from translated pages. It deliberately leaves every other annotation
 * type untouched and performs an atomic replacement after a successful save.
 */
export const PDF_TRANSLATION_POSTPROCESS_SCRIPT = String.raw`
import json
import os
import sys

import pikepdf


def page_xobjects(page):
    resources = page.get('/Resources')
    if resources is None:
        return None
    return resources.get('/XObject')


def restore_source_xobjects(source_pdf, translated_pdf, source_index, translated_index):
    source_xobjects = page_xobjects(source_pdf.pages[source_index])
    translated_xobjects = page_xobjects(translated_pdf.pages[translated_index])
    if source_xobjects is None or translated_xobjects is None:
        return 0

    restored = 0
    for name, source_object in source_xobjects.items():
        if name not in translated_xobjects:
            continue
        translated_xobjects[name] = translated_pdf.copy_foreign(source_object)
        restored += 1
    return restored


def remove_stale_links(page):
    annotations = page.get('/Annots')
    if annotations is None:
        return 0

    retained = pikepdf.Array()
    removed = 0
    for annotation in annotations:
        try:
            subtype = annotation.get('/Subtype')
        except Exception:
            subtype = None
        if subtype == '/Link':
            removed += 1
        else:
            retained.append(annotation)

    if len(retained) > 0:
        page['/Annots'] = retained
    elif '/Annots' in page:
        del page['/Annots']
    return removed


def translated_page_pairs(source_count, translated_count, mode):
    if mode == 'dual' and translated_count == source_count * 2:
        return [(source_index, source_index * 2 + 1) for source_index in range(source_count)]
    limit = min(source_count, translated_count)
    return [(index, index) for index in range(limit)]


def sanitize(source_path, translated_path, mode):
    if not translated_path:
        return {'mode': mode, 'skipped': True, 'restoredXObjects': 0, 'removedLinks': 0}

    temporary_path = translated_path + '.ftranslate-tmp.pdf'
    restored = 0
    removed = 0
    try:
        with pikepdf.open(source_path) as source_pdf, pikepdf.open(translated_path) as translated_pdf:
            for source_index, translated_index in translated_page_pairs(
                len(source_pdf.pages), len(translated_pdf.pages), mode
            ):
                restored += restore_source_xobjects(
                    source_pdf, translated_pdf, source_index, translated_index
                )
                removed += remove_stale_links(translated_pdf.pages[translated_index])
            translated_pdf.save(temporary_path)
        os.replace(temporary_path, translated_path)
    except Exception:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
        raise

    return {
        'mode': mode,
        'skipped': False,
        'restoredXObjects': restored,
        'removedLinks': removed,
    }


source_path = sys.argv[1]
mono_path = sys.argv[2]
dual_path = sys.argv[3]

results = []
seen = set()
if mono_path and mono_path not in seen:
    seen.add(mono_path)
    results.append(sanitize(source_path, mono_path, 'mono'))
if dual_path and dual_path not in seen:
    seen.add(dual_path)
    results.append(sanitize(source_path, dual_path, 'dual'))

print(json.dumps({'ok': True, 'results': results}, ensure_ascii=False))
`;

export function buildPdfTranslationPostprocessInvocation(
  request: PdfTranslationPostprocessRequest
): PdfTranslationPostprocessInvocation {
  return {
    args: [
      '-c',
      PDF_TRANSLATION_POSTPROCESS_SCRIPT,
      request.sourcePdfPath,
      request.monoPdfPath ?? '',
      request.dualPdfPath ?? ''
    ]
  };
}
