import { describe, expect, it } from 'vitest';
import type { ExtractedPdfBlock } from './pdfTextStructure';
import { buildLocalPresentationDraft, buildPresentationDraft, serializePresentationMarkdown } from './presentationOutline';
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
      suggestedSlide: 'method',
      selected: true
    });
    expect(draft.slides.some((slide) => slide.type === 'method')).toBe(true);
    expect(draft.slides.every((slide) => slide.sourceRefs.every((ref) => ref.section !== 'References'))).toBe(true);
    expect(draft.slides.some((slide) => slide.sourceRefs.some((ref) => ref.pageNumber === 6))).toBe(true);
  });

  it('creates chapter-driven slides with multiple bullets and source refs', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'Robot Foundation Model' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'The paper introduces a generalist robot model. It follows diverse language instructions in unseen environments. It uses context conditioning to steer behavior.'
        }),
        block({
          section: 'I. INTRODUCTION',
          page: 2,
          original:
            'Foundation models emerge from large and diverse datasets. Prior robot policies remain limited by narrow task distributions and weak generalization.'
        }),
        block({
          section: 'I. INTRODUCTION',
          page: 2,
          original:
            'The central problem is how to transfer broad web and robot data into reliable embodied behavior without task-specific fine-tuning.'
        }),
        block({
          section: 'II. RELATED WORK',
          page: 3,
          original:
            'Vision-language-action models have improved instruction following. Existing approaches still struggle with long-horizon dexterous manipulation.'
        }),
        block({
          section: 'III. METHOD',
          page: 4,
          original:
            'The model uses a VLA backbone, high-level policy prompts, subgoal images, and episode metadata as conditioning signals.'
        }),
        block({
          type: 'formula',
          section: 'III. METHOD',
          page: 4,
          original: 'L = L_{data} + lambda L_{policy} + beta L_{subgoal}'
        }),
        block({
          type: 'caption',
          section: 'III. METHOD',
          page: 4,
          original: 'Fig. 2. Architecture overview of the VLA policy and world model.'
        }),
        block({
          section: 'IV. EXPERIMENTS',
          page: 6,
          original:
            'The experiments evaluate dexterous tasks across multiple robot platforms. The model improves out-of-the-box success rate and compositional generalization.'
        }),
        block({
          type: 'caption',
          section: 'IV. EXPERIMENTS',
          page: 7,
          original: 'Table 1. Quantitative comparison with specialist policies and imitation learning baselines.'
        }),
        block({
          section: 'References',
          page: 12,
          original: '[1] Doe et al. Prior work. 2025.'
        })
      ],
      targetSlideCount: 12
    });

    const slideTypes = draft.slides.map((slide) => slide.type);

    expect(draft.slides).toHaveLength(12);
    expect(slideTypes).toContain('relatedWork');
    expect(slideTypes).toContain('formula');
    expect(draft.slides.every((slide) => slide.confidence === 'local')).toBe(true);
    expect(draft.slides.every((slide) => slide.bullets.length <= 5)).toBe(true);
    expect(draft.slides.every((slide) => slide.sourceRefs.every((ref) => ref.section !== 'References'))).toBe(true);

    const background = draft.slides.find((slide) => slide.type === 'background');
    expect(background?.bullets.length).toBeGreaterThanOrEqual(2);
    expect(background?.sourceRefs.map((ref) => ref.pageNumber)).toContain(2);

    const method = draft.slides.find((slide) => slide.type === 'method');
    expect(method?.figures[0]).toMatchObject({
      suggestedSlide: 'method',
      selected: true,
      suggestedReason: expect.stringContaining('方法')
    });

    const formula = draft.slides.find((slide) => slide.type === 'formula');
    expect(formula?.bullets.join(' ')).toContain('L = L_{data}');

    const experiments = draft.slides.find((slide) => slide.type === 'experiments');
    expect(experiments?.figures[0]).toMatchObject({
      suggestedSlide: 'experiments',
      selected: true
    });
  });

  it('keeps a stable slide even when experiments are missing', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper()],
      blocks: [
        block({ section: 'Abstract', page: 1, original: 'This paper studies safe path planning.' }),
        block({ section: 'Method', page: 3, original: 'The method combines RL and CBF for safety.' })
      ],
      targetSlideCount: 12
    });

    const experiments = draft.slides.find((slide) => slide.type === 'experiments');
    expect(experiments?.bullets[0]).toContain('原文未明确说明');
    expect(experiments?.sourceRefs).toHaveLength(0);
  });

  it('keeps conclusion-oriented slides when the requested outline is short', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper()],
      blocks: [
        block({ section: 'Abstract', page: 1, original: 'This paper studies safe robot navigation in crowds.' }),
        block({ section: 'Introduction', page: 2, original: 'The planning problem requires safe motion under uncertainty.' }),
        block({ section: 'Method', page: 3, original: 'The method combines reinforcement learning with a CBF safety filter.' }),
        block({ section: 'Experiments', page: 5, original: 'Experiments compare success rate and collision rate against baselines.' }),
        block({ section: 'Results', page: 6, original: 'The proposed method reduces constraint violations in dense scenes.' }),
        block({ section: 'Limitations', page: 8, original: 'The method still depends on reliable obstacle state estimation.' }),
        block({ section: 'Conclusion', page: 9, original: 'The paper suggests safe RL is useful for navigation reproducibility.' })
      ],
      targetSlideCount: 8
    });

    const slideTypes = draft.slides.map((slide) => slide.type);

    expect(draft.slides).toHaveLength(8);
    expect(slideTypes).toEqual(
      expect.arrayContaining(['cover', 'info', 'background', 'method', 'experiments', 'results', 'limitations', 'summary'])
    );
    expect(slideTypes).not.toContain('relatedWork');
    expect(slideTypes).not.toContain('formula');
  });

  it('does not use late method fragments as introduction fallback', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'Robot Foundation Model' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'We present a new robot foundation model that follows language instructions and generalizes across diverse tasks.'
        }),
        block({
          section: 'A. Subtask instructions',
          page: 4,
          original:
            'Following prior work, we include intermediate higher-level text that captures the next semantic subtask as part of the prompt.'
        })
      ],
      targetSlideCount: 12
    });

    const background = draft.slides.find((slide) => slide.type === 'background');
    expect(background?.sourceRefs.some((ref) => ref.pageNumber === 4)).toBe(false);
    expect(background?.bullets.join(' ')).toContain('robot foundation model');
  });

  it('filters pseudocode and formula fragments from narrative slides', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'Async Robot Policy' })],
      blocks: [
        block({
          section: 'Experiments',
          page: 5,
          original:
            'Experiments evaluate the policy across multiple robots and compare task success, failure recovery, and compositional generalization.'
        }),
        block({
          section: 'Results',
          page: 7,
          original:
            '10: end if 11: if H steps elapsed since last inference then 12: a_t follows the policy and returns asynchronously.'
        }),
        block({
          section: 'Results',
          page: 7,
          original: 'a_{t:t+H} ~ pi_theta(a | o_{t-T:t}, C) for t = 0, 1, 2'
        })
      ],
      targetSlideCount: 12
    });

    const pageText = draft.slides.flatMap((slide) => slide.bullets).join(' ');
    expect(pageText).toContain('Experiments evaluate');
    expect(pageText).not.toContain('end if');
    expect(pageText).not.toContain('pi_theta');
  });

  it('filters figure diagram labels from seminar bullets', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'Robot Policy Architecture' })],
      blocks: [
        block({
          section: 'III. METHOD',
          page: 4,
          original:
            'The proposed architecture conditions a robot policy on language, visual observations, and task metadata to improve long-horizon manipulation.'
        }),
        block({
          section: 'III. METHOD',
          page: 5,
          original: 'Subtask: pick up the peeler.'
        }),
        block({
          section: 'III. METHOD',
          page: 5,
          original: 'Language Instructions Subgoal Images Episode Metadata Action Expert World Model.'
        })
      ],
      targetSlideCount: 12
    });

    const pageText = draft.slides.flatMap((slide) => slide.bullets).join(' ');

    expect(pageText).toContain('proposed architecture');
    expect(pageText).not.toContain('Subtask: pick up the peeler');
    expect(pageText).not.toContain('Language Instructions Subgoal Images');
  });

  it('strips spaced PDF section heading noise before creating bullets', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'Robot Training Recipe' })],
      blocks: [
        block({
          section: 'III. METHOD',
          page: 5,
          original:
            'T HE π0.7 M ODEL AND T RAINING R ECIPE We now discuss how we incorporate different context by training on diverse data and model components.'
        })
      ],
      targetSlideCount: 12
    });

    const pageText = draft.slides.flatMap((slide) => slide.bullets).join(' ');

    expect(pageText).toContain('We now discuss');
    expect(pageText).not.toContain('T HE π0.7 M ODEL');
  });

  it('splits long single-sentence PDF paragraphs into more useful seminar bullets', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'Long Sentence Robot Paper' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'We present a system for long-horizon mobile manipulation in cluttered scenes, including multi-stage navigation, object interaction, safety monitoring, and recovery from partial failures without task-specific fine-tuning.'
        })
      ],
      targetSlideCount: 12
    });

    const info = draft.slides.find((slide) => slide.type === 'info');
    const pageText = info?.bullets.join(' ') ?? '';

    expect(info?.bullets.length).toBeGreaterThanOrEqual(2);
    expect(pageText).toContain('multi-stage navigation');
    expect(pageText).toContain('partial failures');
  });

  it('serializes slide sources and figure captions into markdown', () => {
    const draft = buildPresentationDraft({
      papers: [paper({ englishTitle: 'Minimal Paper' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'This paper studies safe path planning for mobile robots and proposes a reproducible evaluation protocol.'
        }),
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
