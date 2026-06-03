import { describe, expect, it } from 'vitest';
import type { PresentationDraft, PresentationFigureCandidate, PresentationSlide, PresentationSlideType } from './presentationOutline';
import {
  SEMINAR_PPT_CANVAS,
  SEMINAR_PPT_LAYOUT,
  SEMINAR_PPT_TYPOGRAPHY,
  buildPptxSlidePlan,
  createPresentationPptxBuffer,
  validatePptxQuality,
  validatePptxSlidePlan
} from './presentationPptx';

const types: PresentationSlideType[] = [
  'cover',
  'info',
  'background',
  'relatedWork',
  'method',
  'formula',
  'experiments',
  'results',
  'innovation',
  'limitations',
  'inspiration',
  'summary'
];

const titles: Record<PresentationSlideType, string> = {
  cover: 'PILOT: Perceptive Integrated Low-level Controller',
  info: '论文基本信息',
  background: '研究背景与问题',
  relatedWork: 'Related Work / 现有不足',
  method: '方法整体框架',
  formula: '关键模块或核心公式',
  experiments: '实验设置',
  results: '实验结果',
  innovation: '创新点总结',
  limitations: '局限性与讨论',
  inspiration: '对我课题的启发',
  summary: '总结'
};

function figure(id: string, suggestedSlide: PresentationSlideType, caption: string, pageNumber: number): PresentationFigureCandidate {
  return {
    imageId: id,
    pageNumber,
    caption,
    source: 'pdf-caption',
    suggestedSlide,
    selected: true,
    suggestedReason: suggestedSlide === 'method' ? '方法框架图' : '实验或结果图'
  };
}

const transparentPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lS+q9QAAAABJRU5ErkJggg==';

function slide(type: PresentationSlideType, index: number, figures: PresentationFigureCandidate[] = []): PresentationSlide {
  const section = type === 'cover' ? 'Cover' : titles[type];
  return {
    id: `slide-${type}`,
    type,
    title: titles[type],
    subtitle: type === 'cover' ? '组会 / 文献汇报' : undefined,
    section,
    confidence: 'local',
    bullets: [
      'Humanoid robots hold great potential for diverse interactions, but most existing whole-body controllers lack exteroceptive awareness.',
      'The paper proposes PILOT, a unified reinforcement learning framework tailored for perceptive loco-manipulation.',
      'Experiments in simulation and on a physical Unitree G1 humanoid validate superior stability and command tracking.',
      'Results highlight robust locomotion and manipulation compared with existing baselines in unstructured scenes.'
    ],
    figures,
    sourceRefs:
      type === 'cover'
        ? []
        : [
            {
              pageNumber: Math.max(1, index),
              section,
              text: 'The first challenge centers on traversing uneven terrain while concurrently executing manipulation over non-planar scenes.'
            }
          ],
    speakerNotes: '用自己的话解释本页核心逻辑，强调原文证据和组会讨论价值。'
  };
}

function makeSeminarDraft(): PresentationDraft {
  const figures = [
    figure('fig-method', 'method', 'Fig. 2. Architecture overview of the loco-manipulation controller.', 4),
    figure('fig-experiment', 'experiments', 'Table 1. Simulation and real-world evaluation results.', 6),
    figure('fig-result', 'results', 'Fig. 5. Ablation and generalization performance.', 7)
  ];

  return {
    id: 'draft-1',
    title: 'PILOT: Perceptive Integrated Low-level Controller',
    subtitle: '研究生组会完整 PPT 草稿',
    createdAt: new Date(0).toISOString(),
    sourcePapers: [
      {
        paperId: 'paper-1',
        title: 'PILOT: Perceptive Integrated Low-level Controller',
        pdfPath: 'D:/papers/pilot.pdf',
        pagesUsed: [1, 2, 4, 6, 7],
        figuresUsed: figures.map((item) => item.imageId)
      }
    ],
    figures,
    slides: types.map((type, index) => {
      const slideFigures = figures.filter((item) => item.suggestedSlide === type);
      return slide(type, index + 1, slideFigures);
    })
  };
}

function asciiRatio(text: string): number {
  if (!text) return 0;
  const ascii = text.match(/[A-Za-z]/gu)?.length ?? 0;
  return ascii / text.length;
}

describe('presentationPptx', () => {
  it('builds a real 16:9 seminar slide plan with controlled academic typography', () => {
    expect(SEMINAR_PPT_CANVAS).toEqual({ width: 13.333, height: 7.5 });
    expect(SEMINAR_PPT_TYPOGRAPHY.coverTitle).toBeLessThanOrEqual(28);
    expect(SEMINAR_PPT_TYPOGRAPHY.title).toBeLessThanOrEqual(22);
    expect(SEMINAR_PPT_TYPOGRAPHY.mainPoint).toBeLessThanOrEqual(13);
    expect(SEMINAR_PPT_TYPOGRAPHY.body).toBeLessThanOrEqual(13.5);
    expect(SEMINAR_PPT_TYPOGRAPHY.takeaway).toBeLessThanOrEqual(9.5);
    expect(SEMINAR_PPT_TYPOGRAPHY.source).toBeLessThanOrEqual(7.5);
    expect(SEMINAR_PPT_LAYOUT.takeawayHeight).toBeLessThanOrEqual(0.35);

    const plan = buildPptxSlidePlan(makeSeminarDraft());

    expect(plan).toHaveLength(12);
    expect(plan.map((item) => item.type)).toEqual(types);
    expect(plan.filter((item) => ['figure', 'diagram', 'table'].includes(item.visual.kind)).length).toBeGreaterThanOrEqual(3);
    expect(plan.every((item) => item.speakerNotes.length > 0)).toBe(true);
    expect(plan.filter((item) => item.type !== 'cover').every((item) => item.sourceFooter.includes('p.'))).toBe(true);
    expect(validatePptxSlidePlan(plan)).toEqual([]);
  });

  it('keeps slide titles, sources, and diagrams aligned with seminar slide types', () => {
    const plan = buildPptxSlidePlan(makeSeminarDraft());
    const info = plan.find((item) => item.type === 'info');
    const background = plan.find((item) => item.type === 'background');
    const method = plan.find((item) => item.type === 'method');

    expect(info?.title).toBe('论文基本信息');
    expect(background?.title).toBe('研究背景');
    expect(method?.title).toBe('方法框架');
    expect(background?.sourceFooter).not.toMatch(/Results|Experiments|Real-world/i);

    const diagramText = plan.flatMap((item) => item.visual.steps).join(' ');
    expect(diagramText).not.toMatch(/论文信息|研究对象|论点|方法线索|汇报目标/u);
    expect(method?.visual.steps.join(' ')).toMatch(/PILOT|RL|感知|控制|动作|机器人|Unitree/u);
  });

  it('keeps paper-specific method, formula, and metric evidence in exported slide plans', () => {
    const methodFigure = figure('fig-method-specific', 'method', 'Fig. 2. Architecture overview of PILOT controller.', 4);
    const resultFigure = figure('fig-result-specific', 'results', 'Table 1. Unitree G1 stability and command tracking results.', 6);
    const draft = makeSeminarDraft();
    draft.figures = [methodFigure, resultFigure];
    draft.slides = draft.slides.map((item) => {
      if (item.type === 'method') {
        return {
          ...item,
          figures: [methodFigure],
          bullets: [
            'PILOT 输入侧使用 LiDAR-based elevation map 感知地形',
            'hybrid internal command 连接任务意图与 whole-body action'
          ],
          sourceRefs: [
            {
              pageNumber: 4,
              section: 'Method',
              text:
                'We propose PILOT with a robot-centric, LiDAR-based elevation map and a hybrid internal command representation to output whole-body actions.'
            }
          ]
        };
      }
      if (item.type === 'formula') {
        return {
          ...item,
          bullets: ['核心公式：L = L_task + lambda L_stability + beta L_tracking'],
          sourceRefs: [
            {
              pageNumber: 5,
              section: 'Method',
              text: 'The training objective is L = L_task + lambda L_stability + beta L_tracking.'
            }
          ]
        };
      }
      if (item.type === 'results') {
        return {
          ...item,
          figures: [resultFigure],
          bullets: ['Unitree G1 用于真机验证', '指标关注 stability、command tracking precision、terrain traversability'],
          sourceRefs: [
            {
              pageNumber: 6,
              section: 'Results',
              text:
                'Simulation and physical Unitree G1 experiments validate stability, command tracking precision, and terrain traversability compared with existing baselines.'
            }
          ]
        };
      }
      return item;
    });

    const plan = buildPptxSlidePlan(draft);
    const method = plan.find((item) => item.type === 'method');
    const formula = plan.find((item) => item.type === 'formula');
    const results = plan.find((item) => item.type === 'results');

    expect(method?.bullets.join(' ')).toMatch(/PILOT|LiDAR|hybrid internal command|whole-body/u);
    expect(method?.visual.steps.join(' ')).toMatch(/PILOT|LiDAR|hybrid internal command|whole-body/u);
    expect(formula?.bullets.join(' ')).toContain('L_task');
    expect(results?.bullets.join(' ')).toMatch(/Unitree G1|stability|command tracking|terrain traversability/u);
    expect(results?.visual.kind).toBe('figure');
    expect(plan.flatMap((item) => item.bullets).join(' ')).not.toMatch(/框架串联|任务指令转成机器人策略|方法强调/u);
  });

  it('does not replace real paper terms with generic seminar placeholders', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) => {
      if (item.type === 'background') {
        return {
          ...item,
          bullets: [
            'The model follows diverse language instructions in unseen environments.',
            'The prompt contains subgoal images and episode metadata for context conditioning.'
          ],
          sourceRefs: [
            {
              pageNumber: 1,
              section: 'Abstract',
              text:
                'π0.7 follows diverse language instructions in unseen environments using context conditioning, subgoal images, and episode metadata for long-horizon tasks.'
            }
          ]
        };
      }
      if (item.type === 'method') {
        return {
          ...item,
          bullets: [
            'PILOT uses a LiDAR-based elevation map and hybrid internal command representation.',
            'The controller outputs whole-body actions for loco-manipulation.'
          ],
          sourceRefs: [
            {
              pageNumber: 4,
              section: 'Method',
              text:
                'PILOT builds a robot-centric LiDAR-based elevation map, uses a hybrid internal command representation, and outputs whole-body actions for perceptive loco-manipulation.'
            }
          ]
        };
      }
      return item;
    });

    const plan = buildPptxSlidePlan(draft);
    const background = plan.find((item) => item.type === 'background');
    const method = plan.find((item) => item.type === 'method');
    const allBullets = plan.flatMap((item) => item.bullets).join(' ');

    expect(background?.bullets.join(' ')).toMatch(/π0\.7|language instruction|subgoal images|episode metadata|long-horizon/u);
    expect(method?.bullets.join(' ')).toMatch(/PILOT|LiDAR|hybrid internal command|whole-body|loco-manipulation/u);
    expect(allBullets).not.toMatch(/结构图对应原文模块链路|策略围绕任务与动作闭环|方法强调模型、控制和执行协同|现有系统在复杂场景下仍有能力边界/u);
  });

  it('does not draw a generic method diagram when source lacks concrete modules', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'method'
        ? {
            ...item,
            figures: [],
            bullets: ['The paper introduces a general model framework and controller architecture.'],
            sourceRefs: [
              {
                pageNumber: 4,
                section: 'Method',
                text: 'The method section describes a model framework, controller architecture, policy, and objective, but does not name concrete modules.'
              }
            ]
          }
        : item
    );

    const method = buildPptxSlidePlan(draft).find((item) => item.type === 'method');

    expect(method?.visual.kind).toBe('none');
    expect(method?.visual.steps.join(' ')).not.toMatch(/输入观测|编码\/建模模块|策略\/规划模块|动作输出|训练目标/u);
  });

  it('does not pad weak background evidence with generic fallback claims', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'background'
        ? {
            ...item,
            bullets: [],
            sourceRefs: [
              {
                pageNumber: 2,
                section: 'I. INTRODUCTION',
                text: 'The paper motivates the study through a broad discussion but does not name a concrete module, task, platform, metric, or observation.'
              }
            ]
          }
        : item
    );

    const background = buildPptxSlidePlan(draft).find((item) => item.type === 'background');

    expect(background?.bullets.join(' ')).not.toMatch(/现有系统在复杂场景下仍有能力边界|论文从真实任务需求出发定义问题|背景页只说明为什么该问题值得研究/u);
  });

  it('rejects generic placeholder diagrams and mismatched sources in quality checks', () => {
    const [badSlide] = buildPptxSlidePlan(makeSeminarDraft()).filter((item) => item.type === 'background');
    const issues = validatePptxQuality([
      {
        ...badSlide,
        title: '论文基本信息',
        sourceFooter: 'p. 1 · Abstract  |  p. 8 · Real-world Results',
        visual: {
          ...badSlide.visual,
          kind: 'diagram',
          steps: ['论文信息', '研究对象', '论点', '汇报目标']
        },
        bullets: ['增强泛化能力']
      }
    ]);

    expect(issues.join('\n')).toMatch(/标题|占位|source|来源/u);
  });

  it('rewrites manuscript-like English bullets into compact Chinese seminar bullets', () => {
    const plan = buildPptxSlidePlan(makeSeminarDraft());
    const normalSlides = plan.filter((item) => item.type !== 'cover');

    normalSlides.forEach((item) => {
      expect(item.bullets.length).toBeGreaterThanOrEqual(2);
      expect(item.bullets.length).toBeLessThanOrEqual(5);
      item.bullets.forEach((bullet) => {
        expect(bullet.length).toBeLessThanOrEqual(42);
        expect(asciiRatio(bullet)).toBeLessThan(0.55);
        expect(bullet).not.toMatch(/\b(the|paper|experiments|humanoid robots)\b/iu);
      });
    });
  });

  it('creates a non-empty editable PPTX zip package from the draft', async () => {
    const buffer = await createPresentationPptxBuffer(makeSeminarDraft());
    const bytes = new Uint8Array(buffer);

    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
  });

  it('embeds cropped figure image assets instead of exporting only a placeholder', async () => {
    const draft = makeSeminarDraft();
    draft.figures[0] = {
      ...draft.figures[0],
      imageDataUrl: transparentPng,
      cropStatus: 'crop-ready'
    };
    draft.slides = draft.slides.map((item) =>
      item.type === 'method'
        ? {
            ...item,
            figures: [draft.figures[0]]
          }
        : item
    );

    const buffer = await createPresentationPptxBuffer(draft);
    const zipText = new TextDecoder('latin1').decode(new Uint8Array(buffer));

    expect(zipText).toContain('ppt/media/');
  });
});
