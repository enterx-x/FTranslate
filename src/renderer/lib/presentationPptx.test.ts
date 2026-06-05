import { describe, expect, it } from 'vitest';
import type { PresentationDraft, PresentationFigureCandidate, PresentationSlide, PresentationSlideType } from './presentationOutline';
import { buildLocalPresentationDraft } from './presentationOutline';
import {
  SEMINAR_PPT_CANVAS,
  SEMINAR_PPT_LAYOUT,
  SEMINAR_PPT_TYPOGRAPHY,
  buildPresentationReviewReport,
  buildPptxEvidenceCards,
  buildPptxSlidePlan,
  createPresentationPptxBuffer,
  normalizePptxOutput,
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
  const typedBullets: Record<PresentationSlideType, string[]> = {
    cover: ['原文 PDF：pilot.pdf', '作者：Xinru Cui 等', '目标：讲清问题、方法、实验和启发'],
    info: ['英文标题：PILOT: Perceptive Integrated Low-level Controller', '作者：Xinru Cui, Linxi Feng, Yixuan Zhou', '来源：IEEE Robotics 2026'],
    background: ['非结构化场景要求同时移动和操作', '传统全身控制缺少外部感知', '复杂地形会破坏稳定执行'],
    relatedWork: ['已有低层控制多依赖平整场地', '感知和控制之间仍有断点', '现有方法难以覆盖移动操作'],
    method: ['PILOT 使用 LiDAR elevation map 输入', 'hybrid internal command 连接任务意图', 'whole-body action 作为控制输出'],
    formula: ['核心目标包含 stability 与 command tracking', 'RL training 优化低层控制策略', '约束项服务 terrain traversability'],
    experiments: ['任务覆盖 simulation 与真实机器人', '对比对象包含 existing baselines', '指标关注 stability 与 command tracking'],
    results: ['Unitree G1 完成真机验证', 'terrain traversability 支撑复杂场景结果', 'baseline 对比支撑结论'],
    innovation: ['外部感知补足低层控制盲区', 'hybrid command 把任务意图接入动作', '真实平台验证方法边界'],
    limitations: ['方法依赖可靠地形感知', '未覆盖所有非结构化场景', '失败边界需要更多实测'],
    inspiration: ['LiDAR 表征可作为安全 RL 输入', 'stability 指标适合复现实验', 'baseline 可用于路径规划对照'],
    summary: ['PILOT 链路是感知到控制闭环', '证据来自仿真和 Unitree G1', '复现优先检查稳定性指标']
  };
  const typedSource: Record<PresentationSlideType, string> = {
    cover: '',
    info: 'The paper is PILOT: A Perceptive Integrated Low-level Controller for loco-manipulation over unstructured scenes.',
    background:
      'The first challenge centers on traversing uneven terrain while concurrently executing manipulation over non-planar scenes.',
    relatedWork:
      'Traditional low-level controllers remain confined to planar or mildly varying surfaces and lack perceptive terrain awareness.',
    method:
      'PILOT uses a robot-centric LiDAR-based elevation map, a hybrid internal command representation, and outputs whole-body actions.',
    formula:
      'The reinforcement learning objective optimizes stability, command tracking precision, and terrain traversability.',
    experiments:
      'Experiments evaluate simulation and physical Unitree G1 tasks against existing baselines using stability and tracking metrics.',
    results:
      'Results validate superior stability, command tracking precision, and terrain traversability compared with existing baselines.',
    innovation:
      'The key design connects external perception with unified loco-manipulation control through hybrid internal commands.',
    limitations:
      'The method still depends on reliable terrain perception and may require broader real-world validation.',
    inspiration:
      'The LiDAR elevation map and stability metrics can be reused as baselines for safe RL and path planning experiments.',
    summary:
      'PILOT links terrain perception, hybrid commands, RL training, and real robot evaluation into one loco-manipulation pipeline.'
  };
  return {
    id: `slide-${type}`,
    type,
    title: titles[type],
    subtitle: type === 'cover' ? '组会 / 文献汇报' : undefined,
    section,
    confidence: 'local',
    bullets: typedBullets[type],
    figures,
    sourceRefs:
      type === 'cover'
        ? []
        : [
            {
              pageNumber: Math.max(1, index),
              section,
              text: typedSource[type]
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

  it('builds evidence cards for text-led slides without falling back to a sparse whiteboard', () => {
    const plan = buildPptxSlidePlan(makeSeminarDraft());
    const background = plan.find((item) => item.type === 'background');

    expect(background).toBeDefined();
    const cards = buildPptxEvidenceCards(background!);

    expect(cards.length).toBeGreaterThanOrEqual(4);
    expect(cards.map((card) => card.label).join(' ')).toMatch(/证据|来源/u);
    expect(cards.map((card) => card.text).join(' ')).toMatch(/PILOT|Unitree|移动操作|复杂地形|低层控制|perceptive/u);
    expect(cards.map((card) => card.text).join(' ')).not.toMatch(/论文信息|研究对象|论点|方法线索|汇报目标/u);
  });

  it('does not use slide-level template claim prefixes as evidence cards', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'background'
        ? {
            ...item,
            bullets: [
              '本页聚焦问题来源：π0.7 关注未见环境指令执行 是问题背景',
              'PILOT 在复杂地形移动操作任务中需要感知低层控制',
              'Unitree G1 真机实验用于验证稳定性'
            ],
            sourceRefs: [
              {
                pageNumber: 1,
                section: 'Introduction',
                text:
                  'PILOT tackles loco-manipulation over unstructured scenes with perceptive low-level control and physical Unitree G1 validation.'
              }
            ]
          }
        : item
    );
    const background = buildPptxSlidePlan(draft).find((item) => item.type === 'background');

    expect(background).toBeDefined();
    expect(background?.mainClaim).not.toMatch(/本页聚焦|问题来源/u);
    const cardText = buildPptxEvidenceCards(background!)
      .map((card) => card.text)
      .join(' ');

    expect(cardText).not.toMatch(/本页聚焦|问题来源/u);
    expect(cardText).toMatch(/PILOT|Unitree|复杂地形|低层控制/u);
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

  it('deduplicates same-page semantic bullets from repeated source evidence', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'background'
        ? {
            ...item,
            bullets: [
              'The model follows diverse language instructions in unseen environments.',
              'Language instructions are provided in the prompt and condition the policy.'
            ],
            sourceRefs: [
              {
                pageNumber: 2,
                section: 'I. INTRODUCTION',
                text:
                  'The model follows diverse language instructions in unseen environments. The prompt contains language instructions, subgoal images, and episode metadata for long-horizon tasks.'
              }
            ]
          }
        : item
    );

    const background = buildPptxSlidePlan(draft).find((item) => item.type === 'background');
    const normalizedBullets = background?.bullets.map((bullet) => bullet.replace(/\s+/gu, ' ').trim().toLowerCase()) ?? [];
    const normalizedMainClaim = background?.mainClaim.replace(/\s+/gu, ' ').trim().toLowerCase();

    expect(normalizedBullets.length).toBeGreaterThan(0);
    expect(new Set(normalizedBullets).size).toBe(normalizedBullets.length);
    expect(normalizedMainClaim).not.toBe(normalizedBullets[0]);
  });

  it('reviews cleaned slide plans instead of raw repeated draft evidence', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      ['background', 'innovation', 'summary'].includes(item.type)
        ? {
            ...item,
            bullets: ['language instruction 作为策略输入', 'VLA/VLM 连接指令与动作', 'subgoal images 提供阶段目标'],
            sourceRefs: [
              {
                pageNumber: item.type === 'background' ? 2 : 4,
                section: item.type === 'background' ? 'I. INTRODUCTION' : item.section ?? 'Method',
                text: 'The paper repeatedly mentions language instructions, VLA/VLM policies, and subgoal images as evidence.'
              }
            ]
          }
        : item
    );

    const report = buildPresentationReviewReport(draft);
    expect(report.repeated_keyword_problem).toBe(false);
  });

  it('deduplicates final strengthened bullets before quality review', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'method' || item.type === 'formula'
        ? {
            ...item,
            bullets: [
              'π0.7 依靠上下文调节策略',
              '上下文/任务表示用于把高层任务要求转成低层控制信号',
              'π0.7 依靠上下文调节策略'
            ],
            sourceRefs: [
              {
                pageNumber: item.type === 'method' ? 4 : 5,
                section: 'Method',
                text:
                  'π0.7 uses context conditioning. Language instructions, subgoal images, and episode metadata are processed into robot actions.'
              }
            ]
          }
        : item
    );

    const plan = buildPptxSlidePlan(draft);
    const issues = validatePptxQuality(plan);
    const bullets = plan.flatMap((item) => item.bullets.map((bullet) => bullet.replace(/\s+/gu, ' ').trim().toLowerCase()));

    expect(new Set(bullets).size).toBe(bullets.length);
    expect(issues.join('\n')).not.toMatch(/重复 bullet|semantic duplicate|noun-phrase stuffing/u);
  });

  it('does not flag raw unselected setup figures when the exported result slide uses result evidence', () => {
    const setupFigure: PresentationFigureCandidate = {
      ...figure('fig-setup-unselected', 'experiments', 'Fig. 4. Robot platform and task examples in the kitchen.', 5),
      figureKind: 'setup',
      selected: false
    };
    const resultFigure: PresentationFigureCandidate = {
      ...figure('fig-result-selected', 'results', 'Table 2. Unitree G1 success rate and tracking comparison results.', 7),
      figureKind: 'result'
    };
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'results'
        ? {
            ...item,
            figures: [setupFigure, resultFigure],
            bullets: ['Unitree G1 完成真机验证', 'success rate 与 tracking 指标支撑结论'],
            sourceRefs: [
              {
                pageNumber: 7,
                section: 'Results',
                text: 'Results compare success rate and command tracking against baselines on Unitree G1.'
              }
            ]
          }
        : item
    );

    const report = buildPresentationReviewReport(draft);

    expect(report.figure_mismatch).toBe(false);
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

  it('hard-fails slide type mismatch and weak method explanation after plan cleanup', async () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) => {
      if (item.type === 'info') {
        return {
          ...item,
          bullets: ['language instruction 作为策略输入', 'VLA/VLM 连接指令与动作', 'subgoal images 提供阶段目标']
        };
      }
      if (item.type === 'background' || item.type === 'innovation' || item.type === 'summary') {
        return {
          ...item,
          bullets: ['language instruction 作为策略输入', 'VLA/VLM 连接指令与动作', 'subgoal images 提供阶段目标'],
          sourceRefs: [
            {
              pageNumber: item.type === 'background' ? 8 : 1,
              section: item.type === 'background' ? 'Results' : item.section ?? 'Abstract',
              text: 'language instruction, VLA/VLM, subgoal images, episode metadata, cross-embodiment.'
            }
          ]
        };
      }
      if (item.type === 'method') {
        return {
          ...item,
          figures: [],
          bullets: ['方法具体包含 VLA/VLM', '方法具体包含 subgoal images'],
          sourceRefs: [
            {
              pageNumber: 4,
              section: 'Method',
              text: 'The method mentions VLA/VLM and subgoal images but does not explain input, process, output, connection, or training logic.'
            }
          ]
        };
      }
      return item;
    });

    const report = buildPresentationReviewReport(draft);
    expect(report.passed).toBe(false);
    expect(report.repeated_keyword_problem).toBe(false);
    expect(report.slide_type_mismatch).toBe(true);
    expect(report.can_identify_method_stages).toBe(false);
    const buffer = await createPresentationPptxBuffer(draft);
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it('filters setup figures away from result slides instead of exporting mismatched evidence', () => {
    const setupFigure: PresentationFigureCandidate = {
      ...figure('fig-setup', 'experiments', 'Fig. 4. Robot platform and task examples in the kitchen.', 5),
      figureKind: 'setup'
    };
    const draft = makeSeminarDraft();
    draft.figures = [setupFigure];
    draft.slides = draft.slides.map((item) =>
      item.type === 'results'
        ? {
            ...item,
            figures: [setupFigure],
            bullets: ['Unitree G1 完成真机验证', 'success rate 用于评估'],
            sourceRefs: [
              {
                pageNumber: 7,
                section: 'Results',
                text: 'Results compare success rate and command tracking against baselines.'
              }
            ]
          }
        : item
    );

    const report = buildPresentationReviewReport(draft);
    const result = buildPptxSlidePlan(draft).find((item) => item.type === 'results');

    expect(result?.figures).toEqual([]);
    expect(report.figure_mismatch).toBe(false);
  });

  it('does not treat paper metadata slides as weak noun-only seminar content', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'info'
        ? {
            ...item,
            bullets: ['英文标题：Visual Check Paper'],
            sourceRefs: [
              {
                pageNumber: 1,
                section: 'Info',
                text: 'Visual Check Paper'
              }
            ]
          }
        : item
    );

    const info = buildPptxSlidePlan(draft).find((item) => item.type === 'info');
    expect(info).toBeDefined();

    const issues = validatePptxQuality([info!]);

    expect(issues.join('\n')).not.toMatch(/名词堆叠|解释价值/u);
  });

  it('pads thin experiment slides with source-backed Chinese evidence before quality review', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'experiments'
        ? {
            ...item,
            bullets: ['simulation and real-world evaluation'],
            figures: [],
            sourceRefs: [
              {
                pageNumber: 6,
                section: 'Experiments',
                text:
                  'The evaluation compares the proposed controller with existing baselines in simulation and real-world tasks using success rate and tracking metrics.'
              }
            ]
          }
        : item
    );

    const experiments = buildPptxSlidePlan(draft).find((item) => item.type === 'experiments');
    expect(experiments).toBeDefined();

    const issues = validatePptxQuality([experiments!]);

    expect(experiments!.bullets.filter((bullet) => /[\u4e00-\u9fff]/u.test(bullet)).length).toBeGreaterThanOrEqual(2);
    expect(issues.join('\n')).not.toMatch(/中文 bullet 少于 2|baseline、metric、result/u);
  });

  it('rewrites weak experiment noun phrases into explanatory bullets before quality review', () => {
    const draft = makeSeminarDraft();
    draft.slides = draft.slides.map((item) =>
      item.type === 'experiments'
        ? {
            ...item,
            bullets: ['baseline', 'platform', 'metric'],
            figures: [],
            sourceRefs: [
              {
                pageNumber: 6,
                section: 'Experiments',
                text:
                  'The evaluation compares the proposed method with existing baselines on robot platform tasks using success rate and tracking metrics.'
              }
            ]
          }
        : item
    );

    const experiments = buildPptxSlidePlan(draft).find((item) => item.type === 'experiments');
    expect(experiments).toBeDefined();

    const issues = validatePptxQuality([experiments!]);

    expect(experiments!.bullets.every((bullet) => /用于|包含|关注|验证|支撑|对比/u.test(bullet))).toBe(true);
    expect(issues.join('\n')).not.toMatch(/名词堆叠|解释价值/u);
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

  it('normalizes browser Blob PPTX output before sending it to Electron for saving', async () => {
    const buffer = await normalizePptxOutput(new Blob([new Uint8Array([80, 75, 3, 4])]));
    const bytes = new Uint8Array(buffer);

    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
    expect(bytes[2]).toBe(3);
    expect(bytes[3]).toBe(4);
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

  it('keeps concrete method architecture and result table evidence in PPTX slide plans', () => {
    const draft = buildLocalPresentationDraft({
      papers: [
        {
          id: 'paper-specific-pptx',
          pdfPath: 'D:/papers/pilot.pdf',
          pdfName: 'pilot.pdf',
          translationPath: '',
          translationName: '',
          chineseTitle: '',
          englishTitle: 'PILOT: A Perceptive Integrated Low-level Controller',
          journal: 'Robotics',
          authors: 'Author A',
          year: '2026',
          notes: '',
          lastOpenedAt: new Date(0).toISOString(),
          lastPage: 1
        }
      ],
      blocks: [
        {
          id: 'm1',
          type: 'paragraph',
          page: 4,
          section: 'Method',
          original:
            'PILOT fuses prediction-based perceptive representations, a cross-modal context encoder, and a Mixture-of-Experts (MoE) policy architecture to coordinate diverse motor skills for loco-manipulation.',
          translation: '',
          sourceHash: 'm1'
        },
        {
          id: 'm2',
          type: 'paragraph',
          page: 4,
          section: 'Method',
          original:
            'The policy takes terrain-aware perceptive features, proprioceptive observations, and task commands, then outputs joint targets and whole-body control actions.',
          translation: '',
          sourceHash: 'm2'
        },
        {
          id: 'f1',
          type: 'formula',
          page: 5,
          section: 'Method',
          original: 'The training objective is J(theta)=E[R_task + 0.6 R_tracking + 0.3 R_stability - 0.2 C_collision].',
          translation: '',
          sourceHash: 'f1'
        },
        {
          id: 'c1',
          type: 'caption',
          page: 5,
          section: 'Method',
          original: 'Fig. 3. Architecture overview of prediction-based perception, cross-modal context encoder, and MoE policy.',
          translation: '',
          sourceHash: 'c1'
        },
        {
          id: 'e1',
          type: 'paragraph',
          page: 7,
          section: 'Experiments',
          original:
            'We evaluate obstacle crossing, slope traversal, narrow passage, and object transport tasks on Unitree G1, comparing against PPO, MPC, and blind baseline controllers using success rate, fall rate, tracking error, command tracking, and terrain traversability.',
          translation: '',
          sourceHash: 'e1'
        },
        {
          id: 'c2',
          type: 'caption',
          page: 8,
          section: 'Results',
          original:
            'Table 2. Quantitative comparison of success rate, fall rate, tracking error, command tracking, and terrain traversability against PPO, MPC, and blind baseline controllers.',
          translation: '',
          sourceHash: 'c2'
        }
      ],
      targetSlideCount: 12
    });

    const plan = buildPptxSlidePlan(draft);
    const method = plan.find((item) => item.type === 'method');
    const formula = plan.find((item) => item.type === 'formula');
    const results = plan.find((item) => item.type === 'results');

    expect(method?.bullets.join(' ')).toMatch(/cross-modal context encoder|Mixture-of-Experts|MoE policy|joint targets/i);
    expect(method?.visual.steps.join(' ')).toMatch(/terrain-aware perceptive features|cross-modal context encoder|MoE policy|joint targets/i);
    expect(method?.visual.caption).toMatch(/prediction-based perception|cross-modal context encoder|MoE policy/i);
    expect(formula?.bullets.join(' ')).toMatch(/J\(theta\)|R_tracking|C_collision/i);
    expect(results?.bullets.join(' ')).toMatch(/Unitree G1|PPO|MPC|blind baseline|success rate|fall rate|tracking error/i);
    expect(results?.visual.kind).toBe('table');
    expect(results?.visual.caption).toMatch(/Quantitative comparison|success rate|fall rate|tracking error/i);
    const focusedIssues = validatePptxQuality(plan.filter((item) => ['method', 'formula', 'experiments', 'results'].includes(item.type))).filter(
      (issue) => !issue.includes('PPT 页数过少')
    );
    expect(focusedIssues).toEqual([]);
  });
});
