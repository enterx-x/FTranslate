import { describe, expect, it } from 'vitest';
import type { PresentationDraft, PresentationFigureCandidate, PresentationSlide, PresentationSlideType } from './presentationOutline';
import {
  SEMINAR_PPT_CANVAS,
  SEMINAR_PPT_TYPOGRAPHY,
  buildPptxSlidePlan,
  createPresentationPptxBuffer,
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
    expect(SEMINAR_PPT_TYPOGRAPHY.coverTitle).toBeLessThanOrEqual(32);
    expect(SEMINAR_PPT_TYPOGRAPHY.title).toBeLessThanOrEqual(24);
    expect(SEMINAR_PPT_TYPOGRAPHY.body).toBeLessThanOrEqual(15);
    expect(SEMINAR_PPT_TYPOGRAPHY.source).toBeLessThanOrEqual(8);

    const plan = buildPptxSlidePlan(makeSeminarDraft());

    expect(plan).toHaveLength(12);
    expect(plan.map((item) => item.type)).toEqual(types);
    expect(plan.filter((item) => ['figure', 'diagram', 'table'].includes(item.visual.kind)).length).toBeGreaterThanOrEqual(3);
    expect(plan.every((item) => item.speakerNotes.length > 0)).toBe(true);
    expect(plan.filter((item) => item.type !== 'cover').every((item) => item.sourceFooter.includes('p.'))).toBe(true);
    expect(validatePptxSlidePlan(plan)).toEqual([]);
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
});
