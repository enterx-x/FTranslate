import { describe, expect, it } from 'vitest';
import type { ExtractedPdfBlock } from './pdfTextStructure';
import { buildPresentationDraft, serializePresentationMarkdown } from './presentationOutline';
import type { PaperRecord } from './papers';

function block(partial: Partial<ExtractedPdfBlock> & Pick<ExtractedPdfBlock, 'original'>): ExtractedPdfBlock {
  return {
    id: partial.id ?? `block-${Math.random()}`,
    type: partial.type ?? 'paragraph',
    page: partial.page ?? 1,
    section: partial.section ?? 'Abstract',
    original: partial.original,
    translation: partial.translation ?? '',
    sourceHash: partial.sourceHash ?? partial.original.slice(0, 16),
    sectionId: partial.sectionId,
    sectionOrder: partial.sectionOrder,
    paragraphOrder: partial.paragraphOrder
  };
}

function paper(partial: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id: partial.id ?? 'paper-1',
    pdfPath: partial.pdfPath ?? 'D:/papers/demo.pdf',
    pdfName: partial.pdfName ?? 'demo.pdf',
    translationPath: '',
    translationName: '',
    chineseTitle: partial.chineseTitle ?? '',
    englishTitle: partial.englishTitle ?? 'A Safe Robot Navigation Method',
    journal: partial.journal ?? 'ICRA',
    authors: partial.authors ?? 'Author A, Author B',
    year: partial.year ?? '2026',
    notes: partial.notes ?? '',
    lastOpenedAt: new Date(0).toISOString(),
    lastPage: 1
  };
}

describe('presentationOutline', () => {
  it('builds a traceable graduate seminar outline from extracted PDF blocks', () => {
    const draft = buildPresentationDraft({
      papers: [paper()],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'We propose a physics-informed reinforcement learning planner for safe navigation in dynamic scenes.'
        }),
        block({
          type: 'caption',
          section: 'Method',
          page: 3,
          original: 'Fig. 2. Overview of the proposed safety-aware planner.'
        }),
        block({
          section: 'Method',
          page: 3,
          original:
            'The method combines a reinforcement learning policy with a control barrier function safety layer.'
        }),
        block({
          section: 'Experiments',
          page: 6,
          original:
            'Experiments compare success rate, collision rate, and path efficiency against PPO and MPC baselines.'
        }),
        block({
          section: 'References',
          page: 9,
          original: '[1] A. Smith. A related paper. 2024.'
        })
      ],
      targetSlideCount: 8
    });

    expect(draft.title).toBe('A Safe Robot Navigation Method');
    expect(draft.sourcePapers[0].pagesUsed).toContain(3);
    expect(draft.figures).toHaveLength(1);
    expect(draft.figures[0]).toMatchObject({
      imageId: 'fig-3-1',
      pageNumber: 3,
      suggestedSlide: 'method'
    });
    expect(draft.slides.some((slide) => slide.type === 'method')).toBe(true);
    expect(draft.slides.every((slide) => slide.sourceRefs.every((ref) => ref.section !== 'References'))).toBe(true);
    expect(draft.slides.some((slide) => slide.sourceRefs.some((ref) => ref.pageNumber === 6))).toBe(true);
  });

  it('serializes slide sources and figure captions into markdown', () => {
    const draft = buildPresentationDraft({
      papers: [paper({ englishTitle: 'Minimal Paper' })],
      blocks: [
        block({ section: 'Abstract', page: 1, original: 'This paper studies safe path planning.' }),
        block({ type: 'caption', section: 'Results', page: 5, original: 'Table 1. Main quantitative results.' })
      ]
    });

    const markdown = serializePresentationMarkdown(draft);

    expect(markdown).toContain('# Minimal Paper');
    expect(markdown).toContain('来源');
    expect(markdown).toContain('p. 1');
    expect(markdown).toContain('Table 1. Main quantitative results.');
  });
});
