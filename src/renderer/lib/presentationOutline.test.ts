import { describe, expect, it } from 'vitest';
import type { ExtractedPdfBlock } from './pdfTextStructure';
import {
  applyAiEnhancedPresentationDraft,
  buildDeepMethodMap,
  buildLocalPresentationDraft,
  buildPresentationDraft,
  buildPresentationAiEnhancementPrompt,
  extractFigureCandidates,
  serializePresentationMarkdown
} from './presentationOutline';
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
    bounds: partial.bounds,
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
      selected: true
    });
    expect(['experiments', 'results']).toContain(experiments?.figures[0]?.suggestedSlide);
  });

  it('turns method and result evidence into paper-specific seminar bullets', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'PILOT: Perceptive Integrated Low-level Controller' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'Humanoid robots hold great potential for daily service tasks, but existing whole-body controllers lack exteroceptive awareness in unstructured scenes.'
        }),
        block({
          section: 'Method',
          page: 4,
          original:
            'We propose PILOT, a perceptive and unified loco-manipulation controller. PILOT incorporates a robot-centric, LiDAR-based elevation map to capture surrounding terrain information and a hybrid internal command representation for whole-body loco-manipulation.'
        }),
        block({
          section: 'Experiments',
          page: 6,
          original:
            'Extensive experiments in simulation and on the physical Unitree G1 humanoid robot validate superior stability, command tracking precision, and terrain traversability compared with existing baselines.'
        })
      ],
      targetSlideCount: 12
    });

    const methodText = draft.slides.find((slide) => slide.type === 'method')?.bullets.join(' ') ?? '';
    const resultsText = draft.slides.find((slide) => slide.type === 'results')?.bullets.join(' ') ?? '';

    expect(methodText).toContain('PILOT');
    expect(methodText).toContain('LiDAR');
    expect(methodText).toContain('hybrid internal command');
    expect(methodText).toMatch(/输入|地形|控制|动作/u);
    expect(methodText).not.toMatch(/\bWe propose\b/iu);

    expect(resultsText).toContain('Unitree G1');
    expect(resultsText).toMatch(/仿真|真机|稳定|跟踪|地形通过/u);
    expect(resultsText).not.toMatch(/\bExtensive experiments\b/iu);
  });

  it('builds a deep method map before creating slides so the method can be explained stage by stage', () => {
    const input = {
      papers: [paper({ englishTitle: 'PILOT: Perceptive Integrated Low-level Controller' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'PILOT addresses loco-manipulation over unstructured scenes where whole-body controllers lack exteroceptive awareness.'
        }),
        block({
          section: 'Method',
          page: 4,
          original:
            'PILOT uses a robot-centric LiDAR-based elevation map, proprioceptive states, and a hybrid internal command representation to output whole-body actions.'
        }),
        block({
          section: 'Training',
          page: 5,
          original:
            'The controller is trained with reinforcement learning to improve stability, command tracking precision, and terrain traversability.'
        }),
        block({
          section: 'Experiments',
          page: 6,
          original:
            'Experiments compare against existing baselines in simulation and on the physical Unitree G1 robot using stability, command tracking, and terrain traversability metrics.'
        })
      ],
      targetSlideCount: 12
    };

    const map = buildDeepMethodMap(input);
    const draft = buildLocalPresentationDraft(input);
    const methodSlideText = draft.slides
      .filter((slide) => slide.type === 'method' || slide.type === 'formula')
      .flatMap((slide) => slide.bullets)
      .join(' ');

    expect(map.core_problem).toMatch(/PILOT|loco-manipulation|unstructured|exteroceptive/i);
    expect(map.method_stages.length).toBeGreaterThanOrEqual(3);
    expect(map.method_stages[0]).toMatchObject({
      input: expect.stringMatching(/LiDAR|proprioceptive/i),
      output: expect.stringMatching(/elevation|terrain|state/i)
    });
    expect(map.method_stages.some((stage) => /whole-body action|control command/i.test(stage.output))).toBe(true);
    expect(map.paper_type).toMatch(/algorithm|system|application/);
    expect(map.prior_work_limitations.join(' ')).toMatch(/lack exteroceptive|unstructured|whole-body/i);
    expect(map.training_or_implementation.what_is_trained_or_built).toMatch(/controller|PILOT|method/i);
    expect(map.training_or_implementation.objective_or_rules).toMatch(/reinforcement learning|stability|command tracking/i);
    expect(map.evaluation_logic.tasks_or_datasets).toMatch(/simulation|Unitree G1|unstructured/i);
    expect(map.evaluation_logic.baselines).toMatch(/existing baselines/i);
    expect(map.evaluation_logic.metrics).toMatch(/stability|command tracking|terrain traversability/i);
    expect(map.evaluation_logic.what_the_results_prove).toMatch(/terrain traversability|stability|command tracking/i);
    expect(map.limitations.author_stated || map.limitations.inferred).toBeTruthy();
    expect(draft.methodMap?.method_stages.length).toBeGreaterThanOrEqual(3);
    expect(methodSlideText).toMatch(/LiDAR|hybrid internal command|whole-body|reinforcement learning/i);
  });

  it('keeps the deep method map rich enough for review agents instead of a flat summary', () => {
    const input = {
      papers: [paper({ englishTitle: 'Grounded Mobile Robot Planner' })],
      blocks: [
        block({
          section: 'Introduction',
          page: 2,
          original:
            'Prior mobile robot planners struggle in dynamic clutter because they do not combine RGB-D observations, occupancy maps, and safety costs.'
        }),
        block({
          section: 'Method',
          page: 4,
          original:
            'The planner takes RGB-D observations and an occupancy map as input, passes them through a perception encoder, predicts latent dynamics with a world model, and uses MPC with a trajectory optimizer to output velocity commands.'
        }),
        block({
          section: 'Training',
          page: 5,
          original:
            'The model is trained with behavior cloning and a safety cost objective so the policy avoids collisions while following waypoints.'
        }),
        block({
          section: 'Experiments',
          page: 7,
          original:
            'Experiments compare against PPO and SAC baselines on mobile robot navigation tasks using success rate, collision rate, path efficiency, and tracking error metrics.'
        }),
        block({
          section: 'Limitations',
          page: 9,
          original:
            'The method still depends on reliable obstacle state estimation and may fail when RGB-D perception is degraded.'
        })
      ],
      targetSlideCount: 12
    };

    const map = buildDeepMethodMap(input);
    const stageText = map.method_stages.map((stage) => `${stage.stage_name} ${stage.input} ${stage.process} ${stage.output}`).join(' ');

    expect(map.paper_type).toBe('algorithm');
    expect(map.core_problem).toMatch(/dynamic clutter|RGB-D|occupancy|safety/i);
    expect(map.prior_work_limitations.join(' ')).toMatch(/Prior mobile robot planners|struggle/i);
    expect(stageText).toMatch(/RGB-D observations|occupancy map|perception encoder|World Model|MPC|trajectory optimizer|velocity command/i);
    expect(map.method_stages.every((stage) => stage.input && stage.process && stage.output && stage.purpose && stage.source)).toBe(true);
    expect(map.training_or_implementation.data_or_inputs).toMatch(/behavior cloning|safety cost|waypoint/i);
    expect(map.training_or_implementation.objective_or_rules).toMatch(/safety cost objective|avoid collisions/i);
    expect(map.evaluation_logic.tasks_or_datasets).toMatch(/mobile robot navigation/i);
    expect(map.evaluation_logic.baselines).toMatch(/PPO|SAC/i);
    expect(map.evaluation_logic.metrics).toMatch(/success rate|collision rate|path efficiency|tracking error/i);
    expect(map.limitations.author_stated).toMatch(/obstacle state estimation|RGB-D perception/i);
  });

  it('classifies figure captions so results slides do not use setup figures as evidence', () => {
    const figures = extractFigureCandidates([
      block({
        type: 'caption',
        section: 'Method',
        page: 3,
        original: 'Fig. 2. Architecture overview of the PILOT controller and LiDAR elevation map pipeline.'
      }),
      block({
        type: 'caption',
        section: 'Experiments',
        page: 5,
        original: 'Fig. 4. Robot platform and unstructured terrain task examples.'
      }),
      block({
        type: 'caption',
        section: 'Results',
        page: 7,
        original: 'Table 1. Quantitative success rate and command tracking comparison against baselines.'
      })
    ]);

    expect(figures.map((item) => item.figureKind)).toEqual(['method', 'setup', 'result']);
    expect(figures[0]).toMatchObject({ suggestedSlide: 'method' });
    expect(figures[1]).toMatchObject({ suggestedSlide: 'experiments' });
    expect(figures[2]).toMatchObject({ suggestedSlide: 'results' });
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
    expect(background?.bullets.length).toBeGreaterThanOrEqual(2);
    expect(background?.bullets.join(' ')).toContain('robot foundation model');
  });

  it('does not let method-map rewriting collapse a content slide to one vague bullet', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'Robot Foundation Model' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'We present π0.7, a robot foundation model that follows diverse language instructions in unseen environments and uses context conditioning to steer behavior.'
        }),
        block({
          section: 'I. INTRODUCTION',
          page: 2,
          original:
            'Foundation models emerge from large and diverse datasets. Prior vision-language-action policies remain limited by narrow robot task distributions and weak out-of-the-box generalization.'
        }),
        block({
          section: 'I. INTRODUCTION',
          page: 2,
          original:
            'The main idea behind π0.7 is to use diverse context conditioning information contained in the prompt, including language commands, subgoal images, and metadata.'
        })
      ],
      targetSlideCount: 12
    });

    const background = draft.slides.find((slide) => slide.type === 'background');
    const text = background?.bullets.join(' ') ?? '';

    expect(background?.bullets.length).toBeGreaterThanOrEqual(3);
    expect(text).toContain('π0.7');
    expect(text).toMatch(/language|context conditioning|subgoal images|VLA|generalization/iu);
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
    expect(pageText).toContain('compositional generalization');
    expect(pageText).toMatch(/指标|实验|验证/u);
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

  it('keeps figure crop metadata when caption blocks include PDF coordinates', () => {
    const draft = buildPresentationDraft({
      papers: [paper({ englishTitle: 'Figure Crop Paper' })],
      blocks: [
        block({
          type: 'caption',
          section: 'Method',
          page: 4,
          original: 'Fig. 2. Architecture overview of the policy and controller.',
          bounds: {
            x: 86,
            y: 610,
            width: 410,
            height: 18,
            pageWidth: 612,
            pageHeight: 792
          }
        })
      ]
    });

    expect(draft.figures[0].cropStatus).toBe('crop-ready');
    expect(draft.figures[0].cropBox).toMatchObject({
      pageWidth: 612,
      pageHeight: 792
    });
    expect(draft.figures[0].cropBox?.y).toBeLessThan(610);
    expect(draft.figures[0].cropBox?.height).toBeGreaterThan(120);
  });

  it('crops below top table captions instead of always cropping above captions', () => {
    const figures = extractFigureCandidates([
      block({
        type: 'caption',
        section: 'Results',
        page: 6,
        original: 'Table 1. Quantitative comparison of success rate, collision rate, and tracking error.',
        bounds: {
          x: 74,
          y: 118,
          width: 470,
          height: 20,
          pageWidth: 612,
          pageHeight: 792
        }
      })
    ]);

    expect(figures[0].cropBox?.y).toBeGreaterThan(118);
    expect(figures[0].cropBox?.height).toBeGreaterThan(120);
  });

  it('applies AI-enhanced slide bullets without dropping sources or figures', () => {
    const draft = buildPresentationDraft({
      papers: [paper({ englishTitle: 'AI Enhanced Robot Paper' })],
      blocks: [
        block({
          section: 'Method',
          page: 3,
          original: 'The model consumes RGB observations, proprioceptive states, and language goals before outputting low-level robot actions.'
        }),
        block({
          type: 'caption',
          section: 'Method',
          page: 3,
          original: 'Fig. 1. Policy network with observation encoder and action head.'
        })
      ],
      targetSlideCount: 8
    });
    const prompt = buildPresentationAiEnhancementPrompt(draft);
    const method = draft.slides.find((slide) => slide.type === 'method');
    const enhanced = applyAiEnhancedPresentationDraft(
      draft,
      JSON.stringify({
        slides: [
          {
            id: method?.id,
            type: 'method',
            title: '方法框架',
            bullets: [
              'RGB 观测、机器人本体状态和语言目标共同输入策略',
              '观测编码器提取场景状态，动作头输出低层动作'
            ],
            speakerNotes: '讲清输入、编码器和动作输出的闭环关系。'
          }
        ]
      })
    );
    const enhancedMethod = enhanced.slides.find((slide) => slide.id === method?.id);

    expect(prompt.userPrompt).toContain(method?.id);
    expect(enhancedMethod?.confidence).toBe('ai-enhanced');
    expect(enhancedMethod?.bullets[0]).toContain('RGB');
    expect(enhancedMethod?.sourceRefs).toEqual(method?.sourceRefs);
    expect(enhancedMethod?.figures).toEqual(method?.figures);
  });

  it('asks AI enhancement to replace generic bullets with source-backed details', () => {
    const draft = buildPresentationDraft({
      papers: [paper({ englishTitle: 'Specific Seminar Prompt Paper' })],
      blocks: [
        block({
          section: 'Method',
          page: 3,
          original:
            'The controller uses LiDAR-based elevation maps, proprioception, and hybrid commands to output whole-body actions.'
        }),
        block({
          section: 'Results',
          page: 7,
          original:
            'The evaluation reports command tracking, terrain traversability, and stability against baselines.'
        })
      ],
      targetSlideCount: 8
    });
    const prompt = buildPresentationAiEnhancementPrompt(draft);

    expect(prompt.userPrompt).toContain('robot platform');
    expect(prompt.userPrompt).toContain('input observation');
    expect(prompt.userPrompt).toContain('baseline');
    expect(prompt.userPrompt).toContain('metric');
    expect(prompt.userPrompt).toContain('Do not use generic bullets');
    expect(prompt.userPrompt).toContain('任务指令转成机器人策略');
  });

  it('extracts paper-specific modules instead of falling back to generic method placeholders', () => {
    const input = {
      papers: [paper({ englishTitle: 'Grounded Mobile Robot Planner' })],
      blocks: [
        block({
          section: 'Method',
          page: 4,
          original:
            'The planner takes RGB-D observations and an occupancy map as input, passes them through a perception encoder, predicts latent dynamics with a world model, and uses MPC with a trajectory optimizer to output velocity commands.'
        }),
        block({
          section: 'Training',
          page: 5,
          original:
            'The model is trained with behavior cloning and a safety cost objective so the policy avoids collisions while following waypoints.'
        }),
        block({
          section: 'Experiments',
          page: 7,
          original:
            'Experiments compare against PPO and SAC baselines on mobile robot navigation tasks using success rate, collision rate, path efficiency, and tracking error metrics.'
        })
      ],
      targetSlideCount: 12
    };

    const map = buildDeepMethodMap(input);
    const draft = buildLocalPresentationDraft(input);
    const methodText = draft.slides
      .filter((slide) => slide.type === 'method' || slide.type === 'formula')
      .flatMap((slide) => slide.bullets)
      .join(' ');
    const resultsText = draft.slides
      .filter((slide) => slide.type === 'experiments' || slide.type === 'results')
      .flatMap((slide) => slide.bullets)
      .join(' ');
    const stageText = map.method_stages.map((stage) => `${stage.input} ${stage.process} ${stage.output}`).join(' ');

    expect(stageText).toContain('RGB-D observations');
    expect(stageText).toContain('occupancy map');
    expect(stageText).toContain('perception encoder');
    expect(stageText).toContain('World Model');
    expect(stageText).toContain('MPC');
    expect(stageText).toContain('velocity command');
    expect(stageText).not.toContain('原文观测输入');
    expect(stageText).not.toContain('任务/上下文表示');

    expect(methodText).toContain('perception encoder');
    expect(methodText).toContain('trajectory optimizer');
    expect(methodText).toContain('safety cost objective');
    expect(resultsText).toContain('PPO');
    expect(resultsText).toContain('SAC');
    expect(resultsText).toContain('tracking error');
  });

  it('preserves paper-specific architecture, formula, and metric terms for a robotics method paper', () => {
    const draft = buildLocalPresentationDraft({
      papers: [paper({ englishTitle: 'PILOT: A Perceptive Integrated Low-level Controller' })],
      blocks: [
        block({
          section: 'Abstract',
          page: 1,
          original:
            'PILOT addresses humanoid loco-manipulation in unstructured scenes where blind low-level controllers struggle with terrain awareness.'
        }),
        block({
          section: 'Method',
          page: 4,
          original:
            'PILOT fuses prediction-based perceptive representations, a cross-modal context encoder, and a Mixture-of-Experts (MoE) policy architecture to coordinate diverse motor skills for loco-manipulation.'
        }),
        block({
          section: 'Method',
          page: 4,
          original:
            'The policy takes terrain-aware perceptive features, proprioceptive observations, and task commands, then outputs joint targets and whole-body control actions.'
        }),
        block({
          type: 'formula',
          section: 'Method',
          page: 5,
          original:
            'The training objective is J(theta)=E[R_task + 0.6 R_tracking + 0.3 R_stability - 0.2 C_collision].'
        }),
        block({
          type: 'caption',
          section: 'Method',
          page: 5,
          original:
            'Fig. 3. Architecture overview of prediction-based perception, cross-modal context encoder, and MoE policy.'
        }),
        block({
          section: 'Experiments',
          page: 7,
          original:
            'We evaluate obstacle crossing, slope traversal, narrow passage, and object transport tasks on Unitree G1, comparing against PPO, MPC, and blind baseline controllers using success rate, fall rate, tracking error, command tracking, and terrain traversability.'
        }),
        block({
          type: 'caption',
          section: 'Results',
          page: 8,
          original:
            'Table 2. Quantitative comparison of success rate, fall rate, tracking error, command tracking, and terrain traversability against PPO, MPC, and blind baseline controllers.'
        })
      ],
      targetSlideCount: 12
    });

    const stageText = draft.methodMap?.method_stages.map((stage) => `${stage.input} ${stage.process} ${stage.output}`).join(' ') ?? '';
    const methodText = draft.slides
      .filter((slide) => slide.type === 'method' || slide.type === 'formula')
      .flatMap((slide) => slide.bullets)
      .join(' ');
    const experimentText = draft.slides
      .filter((slide) => slide.type === 'experiments' || slide.type === 'results')
      .flatMap((slide) => slide.bullets)
      .join(' ');

    expect(stageText).toMatch(/prediction-based perceptive representation|cross-modal context encoder|Mixture-of-Experts|MoE policy/i);
    expect(stageText).toMatch(/terrain-aware perceptive features|proprioceptive observations|task commands|joint targets/i);
    expect(methodText).toMatch(/J\(theta\)|R_tracking|C_collision|cross-modal context encoder|MoE policy/i);
    expect(experimentText).toMatch(/Unitree G1|PPO|MPC|blind baseline|success rate|fall rate|tracking error|terrain traversability/i);
    expect(draft.figures.find((figure) => figure.imageId === 'fig-5-1')).toMatchObject({
      suggestedSlide: 'method',
      figureKind: 'method'
    });
    expect(draft.figures.find((figure) => figure.imageId === 'fig-8-2')).toMatchObject({
      suggestedSlide: 'results',
      figureKind: 'result'
    });
  });
});
