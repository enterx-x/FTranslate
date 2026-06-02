import pptxgen from 'pptxgenjs';
import type {
  PresentationDraft,
  PresentationFigureCandidate,
  PresentationSlide,
  PresentationSlideType
} from './presentationOutline';

export const SEMINAR_PPT_CANVAS = {
  width: 13.333,
  height: 7.5
} as const;

export const SEMINAR_PPT_TYPOGRAPHY = {
  coverTitle: 30,
  coverSubtitle: 13,
  title: 22,
  mainPoint: 14,
  body: 13,
  bodySmall: 11,
  label: 8.5,
  source: 7.5
} as const;

export type PptxSlideLayout = 'cover' | 'context' | 'process' | 'figure-focus' | 'comparison' | 'summary';
export type PptxVisualKind = 'none' | 'diagram' | 'figure' | 'table' | 'quote';

export interface PptxSlideVisualPlan {
  kind: PptxVisualKind;
  title: string;
  caption: string;
  sourceLabel: string;
  figure?: PresentationFigureCandidate;
  steps: string[];
}

export interface PptxSlidePlan {
  id: string;
  index: number;
  layout: PptxSlideLayout;
  type: PresentationSlideType;
  title: string;
  subtitle?: string;
  section: string;
  mainClaim: string;
  bullets: string[];
  visual: PptxSlideVisualPlan;
  figures: PresentationFigureCandidate[];
  sourceFooter: string;
  speakerNotes: string;
}

const COLOR = {
  ink: '111827',
  text: '1F2937',
  muted: '667085',
  weak: '98A2B3',
  paper: 'F7F8FB',
  surface: 'FFFFFF',
  line: 'D7DCE5',
  accent: '5B5CF6',
  accent2: '7C3AED',
  accentSoft: 'EEF0FF',
  blueSoft: 'EAF2FF',
  violetSoft: 'F1EAFF',
  greenSoft: 'E9F8F1',
  amberSoft: 'FFF4D8',
  dark: '0B0C10'
};

const SLIDE_TYPE_META: Record<PresentationSlideType, { title: string; section: string; layout: PptxSlideLayout; visual: PptxVisualKind }> = {
  cover: { title: '文献汇报', section: 'COVER', layout: 'cover', visual: 'none' },
  info: { title: '论文基本信息', section: 'INFO', layout: 'context', visual: 'quote' },
  background: { title: '研究背景与问题', section: 'BACKGROUND', layout: 'context', visual: 'diagram' },
  relatedWork: { title: '现有方法不足', section: 'GAP', layout: 'comparison', visual: 'diagram' },
  method: { title: '方法整体框架', section: 'METHOD', layout: 'figure-focus', visual: 'figure' },
  formula: { title: '关键模块与核心公式', section: 'MODULE', layout: 'process', visual: 'diagram' },
  experiments: { title: '实验设置', section: 'EVALUATION', layout: 'figure-focus', visual: 'table' },
  results: { title: '主要实验结果', section: 'RESULTS', layout: 'figure-focus', visual: 'figure' },
  innovation: { title: '创新点总结', section: 'CONTRIBUTION', layout: 'context', visual: 'diagram' },
  limitations: { title: '局限性与讨论', section: 'LIMITS', layout: 'discussion', visual: 'quote' } as unknown as {
    title: string;
    section: string;
    layout: PptxSlideLayout;
    visual: PptxVisualKind;
  },
  inspiration: { title: '对我课题的启发', section: 'INSPIRATION', layout: 'comparison', visual: 'diagram' },
  summary: { title: '总结', section: 'SUMMARY', layout: 'summary', visual: 'diagram' }
};

const TYPE_FALLBACK_BULLETS: Record<PresentationSlideType, string[]> = {
  cover: ['组会文献汇报', '围绕问题、方法、证据和启发展开'],
  info: ['先交代论文来源、作者和研究对象', '明确本次汇报关注的技术主线', '后续页面只保留和论证有关的信息'],
  background: ['现有系统在复杂场景下仍有能力边界', '论文从真实任务需求出发定义问题', '背景页只说明为什么该问题值得研究'],
  relatedWork: ['已有方法通常依赖更强假设或任务定制', '感知、控制与泛化之间仍存在断点', '本页用于铺垫论文要补上的关键缺口'],
  method: ['方法页优先解释输入、模块和输出关系', '核心不是罗列模块，而是说明设计动机', '框架图用于建立后续实验结果的阅读路径'],
  formula: ['只讲支撑方法理解的关键模块或目标', '公式页聚焦每一项承担的物理或优化含义', '不把完整推导塞进汇报正文'],
  experiments: ['实验页交代任务、baseline 与评价指标', '区分仿真、真实平台和泛化设置', '结果解释必须回到研究问题本身'],
  results: ['结果页优先展示能支撑结论的证据', '说明性能、稳定性或泛化是否真的提升', '避免把论文结论夸大成通用保证'],
  innovation: ['创新点要落在可验证的设计差异上', '突出相对已有工作的真实改动', '说明该设计为什么可能有效'],
  limitations: ['区分作者承认的局限和个人归纳', '关注数据、环境、部署和失败边界', '局限页为后续 idea 留出讨论空间'],
  inspiration: ['提炼可复用模块、实验设计和 baseline', '思考其能否迁移到 RL、PINN 或路径规划', '只提出能被实验验证的后续方向'],
  summary: ['一句话总结论文贡献和适用边界', '明确是否值得复现以及复现优先级', '给出下一步可操作的阅读或实验计划']
};

const KEYWORD_BULLETS: Array<{ pattern: RegExp; bullet: string }> = [
  { pattern: /\bhumanoid|loco[-\s]?manipulation|whole[-\s]?body\b/iu, bullet: '面向复杂地形下的移动操作控制' },
  { pattern: /\breinforcement learning|RL\b/iu, bullet: '用强化学习训练统一低层控制策略' },
  { pattern: /\bperceptive|exteroceptive|terrain|unstructured\b/iu, bullet: '引入外部感知以适应非结构化场景' },
  { pattern: /\bgeneralization|diverse|unseen|cross[-\s]?embodiment\b/iu, bullet: '强调跨任务和未见场景下的泛化能力' },
  { pattern: /\bbenchmark|baseline|evaluation|experiment|result\b/iu, bullet: '通过对比实验验证性能和稳定性' },
  { pattern: /\bablation|robustness|failure|limitation\b/iu, bullet: '用消融或失败案例说明适用边界' },
  { pattern: /\barchitecture|overview|framework|model|controller\b/iu, bullet: '整体框架连接感知、策略和执行输出' },
  { pattern: /\bformula|equation|loss|objective|optimization\b/iu, bullet: '目标函数约束训练信号和模块协同' },
  { pattern: /\brobot|policy|task|command\b/iu, bullet: '任务指令最终转化为可执行机器人策略' },
  { pattern: /\bdata|dataset|demonstration|training\b/iu, bullet: '数据覆盖度直接影响模型训练效果' }
];

export function buildPptxSlidePlan(draft: PresentationDraft): PptxSlidePlan[] {
  return draft.slides.map((slide, index) => {
    const meta = SLIDE_TYPE_META[slide.type];
    const selectedFigures = slide.figures.filter((figure) => figure.selected !== false);
    const visual = buildVisualPlan(slide, selectedFigures);
    const bullets = buildSeminarBullets(slide);
    const mainClaim = buildMainClaim(slide, bullets);
    const sourceFooter = buildSourceFooter(slide, visual.figure);

    return {
      id: slide.id,
      index,
      layout: meta.layout,
      type: slide.type,
      title: buildSlideTitle(slide),
      subtitle: slide.type === 'cover' ? cleanText(slide.subtitle) ?? draft.subtitle : cleanText(slide.subtitle),
      section: cleanText(slide.section) ?? meta.section,
      mainClaim,
      bullets,
      visual,
      figures: selectedFigures,
      sourceFooter,
      speakerNotes: buildSpeakerNotes(slide, bullets, visual)
    };
  });
}

export function validatePptxSlidePlan(plan: PptxSlidePlan[]): string[] {
  const issues: string[] = [];

  if (plan.length < 8) {
    issues.push('PPT 页数过少，无法形成完整组会叙事。');
  }

  plan.forEach((slide) => {
    if (!slide.title.trim()) {
      issues.push(`第 ${slide.index + 1} 页缺少标题。`);
    }
    if (slide.type !== 'cover' && !slide.sourceFooter.includes('p.')) {
      issues.push(`第 ${slide.index + 1} 页缺少可追溯页码来源。`);
    }
    if (!slide.speakerNotes.trim()) {
      issues.push(`第 ${slide.index + 1} 页缺少讲稿备注。`);
    }
    if (slide.bullets.length > 5) {
      issues.push(`第 ${slide.index + 1} 页要点超过 5 条。`);
    }
    slide.bullets.forEach((bullet, bulletIndex) => {
      if (bullet.length > 42) {
        issues.push(`第 ${slide.index + 1} 页第 ${bulletIndex + 1} 条要点过长。`);
      }
      if (asciiRatio(bullet) >= 0.7) {
        issues.push(`第 ${slide.index + 1} 页第 ${bulletIndex + 1} 条仍像英文原文。`);
      }
    });
  });

  return issues;
}

export async function createPresentationPptxBuffer(draft: PresentationDraft): Promise<ArrayBuffer> {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'FTRANSLATE_WIDE', width: SEMINAR_PPT_CANVAS.width, height: SEMINAR_PPT_CANVAS.height });
  pptx.layout = 'FTRANSLATE_WIDE';
  pptx.author = 'FTranslate';
  pptx.company = 'FTranslate';
  pptx.subject = 'Research seminar presentation';
  pptx.title = draft.title;
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei'
  };

  const plan = buildPptxSlidePlan(draft);
  const issues = validatePptxSlidePlan(plan);
  if (issues.length > 0) {
    // 质量问题不阻止导出，但写入备注方便用户后续定位。
    plan[0].speakerNotes = `${plan[0].speakerNotes}\n\n导出质量提示：\n${issues.join('\n')}`;
  }

  plan.forEach((slidePlan) => addPlannedSlide(pptx, slidePlan, draft));

  const output = await pptx.write({ outputType: 'arraybuffer', compression: true });
  return normalizePptxOutput(output);
}

function addPlannedSlide(pptx: pptxgen, plan: PptxSlidePlan, draft: PresentationDraft): void {
  const slide = pptx.addSlide();
  slide.background = { color: COLOR.paper };

  switch (plan.layout) {
    case 'cover':
      drawCoverSlide(pptx, slide, plan, draft);
      break;
    case 'figure-focus':
      drawFigureFocusSlide(pptx, slide, plan);
      break;
    case 'process':
      drawProcessSlide(pptx, slide, plan);
      break;
    case 'comparison':
      drawComparisonSlide(pptx, slide, plan);
      break;
    case 'summary':
      drawSummarySlide(pptx, slide, plan);
      break;
    default:
      drawContextSlide(pptx, slide, plan);
      break;
  }

  slide.addNotes(plan.speakerNotes);
}

function drawCoverSlide(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan, draft: PresentationDraft): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SEMINAR_PPT_CANVAS.width,
    h: SEMINAR_PPT_CANVAS.height,
    fill: { color: COLOR.surface },
    line: { color: COLOR.surface }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: SEMINAR_PPT_CANVAS.height,
    fill: { color: COLOR.dark },
    line: { color: COLOR.dark }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.18,
    y: 0,
    w: 0.05,
    h: SEMINAR_PPT_CANVAS.height,
    fill: { color: COLOR.accent },
    line: { color: COLOR.accent }
  });
  slide.addText('FTRANSLATE SEMINAR', {
    x: 0.72,
    y: 0.64,
    w: 4.4,
    h: 0.24,
    fontFace: 'Aptos',
    fontSize: SEMINAR_PPT_TYPOGRAPHY.label,
    bold: true,
    color: COLOR.accent
  });
  slide.addText(plan.title, {
    x: 0.72,
    y: 1.2,
    w: 8.5,
    h: 1.35,
    fontFace: 'Microsoft YaHei',
    fontSize: SEMINAR_PPT_TYPOGRAPHY.coverTitle,
    bold: true,
    color: COLOR.ink,
    fit: 'shrink',
    breakLine: false
  });
  slide.addText(plan.subtitle ?? '组会 / 文献汇报', {
    x: 0.75,
    y: 2.65,
    w: 6.4,
    h: 0.32,
    fontSize: SEMINAR_PPT_TYPOGRAPHY.coverSubtitle,
    color: COLOR.muted
  });
  drawCoverEvidenceBand(slide, draft, 0.75, 4.7);
  slide.addText('按问题、方法、证据、局限与启发组织，不堆叠原文段落。', {
    x: 0.75,
    y: 6.52,
    w: 7.2,
    h: 0.26,
    fontSize: 10.5,
    color: COLOR.muted
  });
  slide.addText(formatDate(draft.createdAt), {
    x: 10.7,
    y: 6.52,
    w: 1.9,
    h: 0.24,
    align: 'right',
    fontSize: SEMINAR_PPT_TYPOGRAPHY.source,
    color: COLOR.weak
  });
}

function drawContextSlide(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan): void {
  drawSlideHeader(slide, plan);
  drawMainPoint(slide, plan, 0.72, 1.12, 7.2, 0.78);
  drawBulletList(slide, plan.bullets, 0.88, 2.15, 6.65, 2.85);
  drawCompactSchematic(pptx, slide, plan, 8.15, 1.35, 4.15, 3.85);
  drawTakeawayStrip(slide, plan, 0.72, 5.55, 11.7, 0.58);
  drawFooter(slide, plan);
}

function drawProcessSlide(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan): void {
  drawSlideHeader(slide, plan);
  drawMainPoint(slide, plan, 0.72, 1.1, 11.6, 0.62);
  drawWideProcessDiagram(pptx, slide, plan, 0.82, 2.0, 11.35, 2.75);
  drawBulletList(slide, plan.bullets.slice(0, 3), 0.88, 5.1, 10.5, 0.7, true);
  drawFooter(slide, plan);
}

function drawFigureFocusSlide(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan): void {
  drawSlideHeader(slide, plan);
  const figureWide = plan.type === 'method' || plan.type === 'results';
  if (figureWide) {
    drawFigureEvidence(pptx, slide, plan, 0.75, 1.22, 8.0, 4.55);
    drawInterpretationRail(slide, plan, 9.05, 1.22, 3.32, 4.55);
  } else {
    drawFigureEvidence(pptx, slide, plan, 0.75, 1.28, 6.1, 4.48);
    drawInterpretationRail(slide, plan, 7.18, 1.28, 5.18, 4.48);
  }
  drawFooter(slide, plan);
}

function drawComparisonSlide(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan): void {
  drawSlideHeader(slide, plan);
  drawMainPoint(slide, plan, 0.72, 1.08, 11.6, 0.58);
  const headers = plan.type === 'relatedWork' ? ['已有路径', '关键不足', '本文补位'] : ['可复用', '需验证', '后续 idea'];
  headers.forEach((header, index) => {
    const x = 0.78 + index * 4.05;
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 2.0,
      w: 3.55,
      h: 2.9,
      rectRadius: 0.08,
      fill: { color: index === 1 ? COLOR.violetSoft : COLOR.surface },
      line: { color: COLOR.line, width: 0.8 }
    });
    slide.addText(header, {
      x: x + 0.22,
      y: 2.22,
      w: 3.05,
      h: 0.28,
      fontSize: 11,
      bold: true,
      color: index === 1 ? COLOR.accent2 : COLOR.ink
    });
    slide.addText(plan.bullets[index] ?? TYPE_FALLBACK_BULLETS[plan.type][index] ?? '原文未明确说明', {
      x: x + 0.22,
      y: 2.72,
      w: 3.05,
      h: 1.35,
      fontSize: 12.2,
      color: COLOR.text,
      fit: 'shrink',
      breakLine: false
    });
    slide.addText(index === 1 ? '讨论重点' : '证据线索', {
      x: x + 0.22,
      y: 4.42,
      w: 2.2,
      h: 0.2,
      fontSize: SEMINAR_PPT_TYPOGRAPHY.source,
      color: COLOR.muted
    });
  });
  drawFooter(slide, plan);
}

function drawSummarySlide(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan): void {
  drawSlideHeader(slide, plan);
  drawMainPoint(slide, plan, 0.82, 1.28, 10.8, 0.72);
  plan.bullets.slice(0, 3).forEach((bullet, index) => {
    const y = 2.55 + index * 1.03;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1.15,
      y,
      w: 10.2,
      h: 0.68,
      rectRadius: 0.08,
      fill: { color: index === 0 ? COLOR.accentSoft : COLOR.surface },
      line: { color: COLOR.line, width: 0.8 }
    });
    slide.addText(String(index + 1).padStart(2, '0'), {
      x: 1.4,
      y: y + 0.18,
      w: 0.42,
      h: 0.2,
      fontSize: 9,
      bold: true,
      color: COLOR.accent
    });
    slide.addText(bullet, {
      x: 2.0,
      y: y + 0.13,
      w: 8.6,
      h: 0.28,
      fontSize: 13.5,
      bold: true,
      color: COLOR.ink,
      fit: 'shrink'
    });
  });
  drawFooter(slide, plan);
}

function drawSlideHeader(slide: pptxgen.Slide, plan: PptxSlidePlan): void {
  slide.addText(plan.section, {
    x: 0.72,
    y: 0.32,
    w: 2.4,
    h: 0.22,
    fontFace: 'Aptos',
    fontSize: SEMINAR_PPT_TYPOGRAPHY.label,
    bold: true,
    color: COLOR.accent
  });
  slide.addText(plan.title, {
    x: 0.72,
    y: 0.56,
    w: 9.4,
    h: 0.42,
    fontSize: SEMINAR_PPT_TYPOGRAPHY.title,
    bold: true,
    color: COLOR.ink,
    fit: 'shrink',
    breakLine: false
  });
  slide.addText(String(plan.index + 1).padStart(2, '0'), {
    x: 11.85,
    y: 0.58,
    w: 0.5,
    h: 0.2,
    align: 'right',
    fontSize: 9,
    color: COLOR.weak,
    bold: true
  });
  slide.addShape('line', {
    x: 0.72,
    y: 1.0,
    w: 11.7,
    h: 0,
    line: { color: COLOR.line, width: 0.7 }
  });
}

function drawMainPoint(slide: pptxgen.Slide, plan: PptxSlidePlan, x: number, y: number, w: number, h: number): void {
  slide.addShape('line', {
    x,
    y: y + 0.06,
    w: 0,
    h: h - 0.12,
    line: { color: COLOR.accent, width: 2.1 }
  });
  slide.addText(plan.mainClaim, {
    x: x + 0.18,
    y,
    w: w - 0.18,
    h,
    fontSize: SEMINAR_PPT_TYPOGRAPHY.mainPoint,
    bold: true,
    color: COLOR.ink,
    fit: 'shrink',
    breakLine: false
  });
}

function drawBulletList(
  slide: pptxgen.Slide,
  bullets: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  compact = false
): void {
  const rowGap = compact ? 0.36 : 0.58;
  bullets.slice(0, compact ? 3 : 5).forEach((bullet, index) => {
    const itemY = y + index * rowGap;
    slide.addShape('ellipse', {
      x,
      y: itemY + 0.08,
      w: 0.13,
      h: 0.13,
      fill: { color: COLOR.accent },
      line: { color: COLOR.accent }
    });
    slide.addText(bullet, {
      x: x + 0.28,
      y: itemY,
      w,
      h: compact ? 0.28 : 0.36,
      fontSize: compact ? 11.6 : SEMINAR_PPT_TYPOGRAPHY.body,
      color: COLOR.text,
      fit: 'shrink',
      breakLine: false
    });
  });
}

function drawFigureEvidence(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan, x: number, y: number, w: number, h: number): void {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: COLOR.surface },
    line: { color: COLOR.line, width: 0.9 }
  });
  slide.addText(plan.visual.title, {
    x: x + 0.25,
    y: y + 0.18,
    w: w - 0.5,
    h: 0.25,
    fontSize: 10,
    bold: true,
    color: COLOR.accent
  });
  if (plan.visual.kind === 'figure' || plan.visual.kind === 'table') {
    drawFigurePlaceholder(pptx, slide, plan, x + 0.35, y + 0.58, w - 0.7, h - 1.55);
  } else {
    drawCompactSchematic(pptx, slide, plan, x + 0.35, y + 0.58, w - 0.7, h - 1.55);
  }
  slide.addText(plan.visual.caption, {
    x: x + 0.28,
    y: y + h - 0.72,
    w: w - 0.56,
    h: 0.42,
    fontSize: 9.4,
    color: COLOR.text,
    fit: 'shrink',
    breakLine: false
  });
  slide.addText(plan.visual.sourceLabel || plan.sourceFooter, {
    x: x + 0.28,
    y: y + h - 0.28,
    w: w - 0.56,
    h: 0.17,
    fontSize: SEMINAR_PPT_TYPOGRAPHY.source,
    color: COLOR.muted,
    fit: 'shrink'
  });
}

function drawFigurePlaceholder(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  plan: PptxSlidePlan,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: plan.visual.kind === 'table' ? 'FBFCFE' : 'F3F5FA' },
    line: { color: 'CBD5E1', width: 0.8, transparency: 20 }
  });
  if (plan.visual.kind === 'table') {
    drawMiniTable(slide, x + 0.25, y + 0.35, w - 0.5, h - 0.7);
    return;
  }

  const stageY = y + h * 0.46;
  const steps = plan.visual.steps.slice(0, 4);
  steps.forEach((step, index) => {
    const itemX = x + 0.35 + index * ((w - 0.7) / Math.max(1, steps.length));
    const boxW = Math.min(1.35, (w - 1.2) / Math.max(1, steps.length));
    slide.addShape(pptx.ShapeType.roundRect, {
      x: itemX,
      y: stageY,
      w: boxW,
      h: 0.58,
      rectRadius: 0.08,
      fill: { color: index % 2 === 0 ? COLOR.blueSoft : COLOR.violetSoft },
      line: { color: 'CBD5E1', width: 0.6 }
    });
    slide.addText(step, {
      x: itemX + 0.08,
      y: stageY + 0.16,
      w: boxW - 0.16,
      h: 0.18,
      fontSize: 8.2,
      bold: true,
      align: 'center',
      color: COLOR.text,
      fit: 'shrink'
    });
    if (index < steps.length - 1) {
      slide.addShape('line', {
        x: itemX + boxW,
        y: stageY + 0.29,
        w: 0.42,
        h: 0,
        line: { color: COLOR.accent, width: 1, beginArrowType: 'none', endArrowType: 'triangle' }
      });
    }
  });
  slide.addText('原文图表待裁剪 - 已保留 caption 与页码来源', {
    x: x + 0.3,
    y: y + h - 0.42,
    w: w - 0.6,
    h: 0.18,
    align: 'center',
    fontSize: 8,
    color: COLOR.weak
  });
}

function drawInterpretationRail(slide: pptxgen.Slide, plan: PptxSlidePlan, x: number, y: number, w: number, h: number): void {
  slide.addText('解读要点', {
    x,
    y,
    w,
    h: 0.24,
    fontSize: 10,
    bold: true,
    color: COLOR.accent
  });
  drawBulletList(slide, plan.bullets.slice(0, 4), x + 0.02, y + 0.5, w - 0.25, h - 1.2);
  slide.addShape('roundRect', {
    x,
    y: y + h - 0.78,
    w,
    h: 0.58,
    rectRadius: 0.07,
    fill: { color: COLOR.accentSoft },
    line: { color: 'D8D4FF', width: 0.6 }
  });
  slide.addText(plan.mainClaim, {
    x: x + 0.18,
    y: y + h - 0.62,
    w: w - 0.36,
    h: 0.25,
    fontSize: 10.5,
    bold: true,
    color: COLOR.ink,
    fit: 'shrink',
    breakLine: false
  });
}

function drawWideProcessDiagram(pptx: pptxgen, slide: pptxgen.Slide, plan: PptxSlidePlan, x: number, y: number, w: number, h: number): void {
  const steps = plan.visual.steps.slice(0, 5);
  const boxW = (w - 0.55 * (steps.length - 1)) / steps.length;
  steps.forEach((step, index) => {
    const itemX = x + index * (boxW + 0.55);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: itemX,
      y,
      w: boxW,
      h,
      rectRadius: 0.11,
      fill: { color: index === 0 ? COLOR.greenSoft : index === steps.length - 1 ? COLOR.accentSoft : COLOR.surface },
      line: { color: COLOR.line, width: 0.8 }
    });
    slide.addText(String(index + 1).padStart(2, '0'), {
      x: itemX + 0.18,
      y: y + 0.22,
      w: 0.42,
      h: 0.2,
      fontSize: 8.5,
      bold: true,
      color: COLOR.accent
    });
    slide.addText(step, {
      x: itemX + 0.18,
      y: y + 0.78,
      w: boxW - 0.36,
      h: 0.62,
      fontSize: 12,
      bold: true,
      align: 'center',
      color: COLOR.ink,
      fit: 'shrink',
      breakLine: false
    });
    slide.addText(getStepHint(plan.type, index), {
      x: itemX + 0.18,
      y: y + 1.62,
      w: boxW - 0.36,
      h: 0.55,
      fontSize: 8.4,
      align: 'center',
      color: COLOR.muted,
      fit: 'shrink'
    });
    if (index < steps.length - 1) {
      slide.addShape('line', {
        x: itemX + boxW + 0.1,
        y: y + h / 2,
        w: 0.35,
        h: 0,
        line: { color: COLOR.accent, width: 1, endArrowType: 'triangle' }
      });
    }
  });
}

function drawCompactSchematic(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  plan: PptxSlidePlan,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: COLOR.surface },
    line: { color: COLOR.line, width: 0.8 }
  });
  const centerX = x + w / 2 - 0.85;
  const centerY = y + h / 2 - 0.36;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: centerX,
    y: centerY,
    w: 1.7,
    h: 0.72,
    rectRadius: 0.12,
    fill: { color: COLOR.accent },
    line: { color: COLOR.accent }
  });
  slide.addText(getCenterNodeLabel(plan.type), {
    x: centerX + 0.1,
    y: centerY + 0.19,
    w: 1.5,
    h: 0.2,
    align: 'center',
    fontSize: 9,
    bold: true,
    color: 'FFFFFF',
    fit: 'shrink'
  });
  const nodes = plan.visual.steps.slice(0, 4);
  const positions = [
    [x + 0.28, y + 0.35],
    [x + w - 1.58, y + 0.35],
    [x + 0.28, y + h - 0.85],
    [x + w - 1.58, y + h - 0.85]
  ];
  nodes.forEach((node, index) => {
    const [nodeX, nodeY] = positions[index] ?? positions[0];
    slide.addShape(pptx.ShapeType.roundRect, {
      x: nodeX,
      y: nodeY,
      w: 1.3,
      h: 0.5,
      rectRadius: 0.08,
      fill: { color: index % 2 === 0 ? COLOR.blueSoft : COLOR.violetSoft },
      line: { color: 'CBD5E1', width: 0.6 }
    });
    slide.addText(node, {
      x: nodeX + 0.06,
      y: nodeY + 0.15,
      w: 1.18,
      h: 0.16,
      align: 'center',
      fontSize: 7.6,
      bold: true,
      color: COLOR.text,
      fit: 'shrink'
    });
    slide.addShape('line', {
      x: Math.min(centerX + 0.85, nodeX + 0.65),
      y: Math.min(centerY + 0.36, nodeY + 0.25),
      w: Math.abs(centerX + 0.85 - (nodeX + 0.65)),
      h: Math.abs(centerY + 0.36 - (nodeY + 0.25)),
      line: { color: 'A8B0FF', width: 0.75, transparency: 25 }
    });
  });
}

function drawMiniTable(slide: pptxgen.Slide, x: number, y: number, w: number, h: number): void {
  const headers = ['设置', '对比', '指标'];
  const rows = ['任务/平台', 'Baseline', '核心结果'];
  const rowH = h / 4;
  headers.forEach((header, index) => {
    slide.addShape('rect', {
      x: x + index * (w / 3),
      y,
      w: w / 3,
      h: rowH,
      fill: { color: COLOR.accentSoft },
      line: { color: COLOR.line, width: 0.5 }
    });
    slide.addText(header, {
      x: x + index * (w / 3) + 0.06,
      y: y + 0.08,
      w: w / 3 - 0.12,
      h: 0.14,
      align: 'center',
      fontSize: 7.6,
      bold: true,
      color: COLOR.accent
    });
  });
  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < 3; col += 1) {
      slide.addShape('rect', {
        x: x + col * (w / 3),
        y: y + (rowIndex + 1) * rowH,
        w: w / 3,
        h: rowH,
        fill: { color: 'FFFFFF' },
        line: { color: COLOR.line, width: 0.5 }
      });
      slide.addText(col === 0 ? row : '原文提取', {
        x: x + col * (w / 3) + 0.06,
        y: y + (rowIndex + 1) * rowH + 0.08,
        w: w / 3 - 0.12,
        h: 0.14,
        align: 'center',
        fontSize: 7.2,
        color: COLOR.text,
        fit: 'shrink'
      });
    }
  });
}

function drawTakeawayStrip(slide: pptxgen.Slide, plan: PptxSlidePlan, x: number, y: number, w: number, h: number): void {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.07,
    fill: { color: COLOR.dark },
    line: { color: COLOR.dark }
  });
  slide.addText(`Takeaway  ${plan.mainClaim}`, {
    x: x + 0.22,
    y: y + 0.18,
    w: w - 0.44,
    h: 0.18,
    fontSize: 10,
    bold: true,
    color: 'FFFFFF',
    fit: 'shrink'
  });
}

function drawFooter(slide: pptxgen.Slide, plan: PptxSlidePlan): void {
  slide.addShape('line', {
    x: 0.72,
    y: 6.84,
    w: 11.7,
    h: 0,
    line: { color: COLOR.line, width: 0.6 }
  });
  slide.addText(plan.sourceFooter || 'Source: PDF text layer', {
    x: 0.72,
    y: 6.94,
    w: 8.7,
    h: 0.16,
    fontSize: SEMINAR_PPT_TYPOGRAPHY.source,
    color: COLOR.muted,
    fit: 'shrink'
  });
  slide.addText('FTranslate', {
    x: 10.92,
    y: 6.94,
    w: 1.5,
    h: 0.16,
    align: 'right',
    fontSize: SEMINAR_PPT_TYPOGRAPHY.source,
    color: COLOR.weak
  });
}

function drawCoverEvidenceBand(slide: pptxgen.Slide, draft: PresentationDraft, x: number, y: number): void {
  const items: Array<[string, string]> = [
    ['Slides', String(draft.slides.length)],
    ['Figures', String(draft.figures.length)],
    ['Sources', String(draft.sourcePapers.length)]
  ];
  items.forEach(([label, value], index) => {
    const itemX = x + index * 1.8;
    slide.addShape('roundRect', {
      x: itemX,
      y,
      w: 1.45,
      h: 0.72,
      rectRadius: 0.08,
      fill: { color: COLOR.paper },
      line: { color: COLOR.line, width: 0.8 }
    });
    slide.addText(value, {
      x: itemX + 0.18,
      y: y + 0.13,
      w: 1.05,
      h: 0.24,
      fontSize: 15,
      bold: true,
      color: COLOR.ink
    });
    slide.addText(label, {
      x: itemX + 0.18,
      y: y + 0.45,
      w: 1.05,
      h: 0.16,
      fontSize: SEMINAR_PPT_TYPOGRAPHY.source,
      color: COLOR.muted
    });
  });
}

function buildSeminarBullets(slide: PresentationSlide): string[] {
  if (slide.type === 'cover') {
    return compactUnique([cleanText(slide.subtitle), ...TYPE_FALLBACK_BULLETS.cover], 3);
  }

  const sourceText = [
    slide.title,
    slide.section,
    ...slide.bullets,
    ...slide.sourceRefs.map((ref) => ref.text),
    ...slide.figures.map((figure) => figure.caption)
  ].join(' ');
  const keywordBullets = KEYWORD_BULLETS.filter((item) => item.pattern.test(sourceText)).map((item) => item.bullet);
  const typeBullets = TYPE_FALLBACK_BULLETS[slide.type];
  const derivedBullets = slide.sourceRefs
    .slice(0, 2)
    .map((ref) => summarizeRefAsChinese(slide.type, ref.text))
    .filter(Boolean);

  return compactUnique([...keywordBullets, ...derivedBullets, ...typeBullets], 5);
}

function buildMainClaim(slide: PresentationSlide, bullets: string[]): string {
  if (slide.type === 'cover') {
    return '围绕问题、方法、证据和启发组织组会汇报';
  }
  return bullets[0] ?? TYPE_FALLBACK_BULLETS[slide.type][0] ?? '原文未明确说明';
}

function buildSlideTitle(slide: PresentationSlide): string {
  const metaTitle = SLIDE_TYPE_META[slide.type].title;
  if (slide.type === 'cover') {
    return cleanText(slide.title) ?? metaTitle;
  }
  return metaTitle;
}

function buildVisualPlan(slide: PresentationSlide, figures: PresentationFigureCandidate[]): PptxSlideVisualPlan {
  const meta = SLIDE_TYPE_META[slide.type];
  const figure = figures[0];
  const sourceLabel = figure ? `Source: p. ${figure.pageNumber}, ${truncateText(figure.caption, 70)}` : buildSourceFooter(slide);
  const steps = buildVisualSteps(slide);

  if (figure) {
    return {
      kind: meta.visual === 'table' ? 'table' : 'figure',
      title: meta.visual === 'table' ? '实验/结果表格证据' : '原文图表证据',
      caption: truncateText(figure.caption, 96),
      sourceLabel,
      figure,
      steps
    };
  }

  if (['method', 'formula', 'background', 'relatedWork', 'innovation', 'inspiration', 'summary'].includes(slide.type)) {
    return {
      kind: 'diagram',
      title: '生成式结构示意图',
      caption: '未找到可直接裁剪的原文图表，使用可编辑结构图表达本页逻辑。',
      sourceLabel,
      steps
    };
  }

  return {
    kind: meta.visual,
    title: '证据摘要',
    caption: slide.sourceRefs[0] ? truncateText(slide.sourceRefs[0].text, 96) : '原文未明确说明',
    sourceLabel,
    steps
  };
}

function buildVisualSteps(slide: PresentationSlide): string[] {
  switch (slide.type) {
    case 'background':
      return ['现实需求', '能力瓶颈', '研究问题', '验证目标'];
    case 'relatedWork':
      return ['已有方法', '关键假设', '缺口', '本文补位'];
    case 'method':
      return ['输入感知', '特征编码', '策略模块', '动作输出'];
    case 'formula':
      return ['目标函数', '约束项', '训练信号', '优化结果'];
    case 'experiments':
      return ['任务设置', 'Baseline', '评价指标', '真实验证'];
    case 'results':
      return ['主结果', '泛化', '稳定性', '消融'];
    case 'innovation':
      return ['设计差异', '证据支撑', '适用边界', '可复用点'];
    case 'limitations':
      return ['数据依赖', '环境边界', '失败案例', '后续问题'];
    case 'inspiration':
      return ['可复用模块', '对照实验', '评价指标', '新 idea'];
    case 'summary':
      return ['贡献', '证据', '边界', '下一步'];
    default:
      return ['论文信息', '研究对象', '方法线索', '汇报目标'];
  }
}

function summarizeRefAsChinese(type: PresentationSlideType, text: string): string {
  const lower = text.toLowerCase();
  if (/\bterrain|unstructured|scene|environment\b/u.test(lower)) {
    return '研究重点落在非结构化环境中的可靠执行';
  }
  if (/\bcontrol|controller|policy|action\b/u.test(lower)) {
    return '控制策略需要同时处理运动和任务执行';
  }
  if (/\bexperiment|evaluation|baseline|simulation|real\b/u.test(lower)) {
    return '实验围绕仿真、真实平台和 baseline 展开';
  }
  if (/\bmethod|framework|architecture|model\b/u.test(lower)) {
    return '方法强调模块协同而非单一组件堆叠';
  }
  if (/\blimitation|future|failure\b/u.test(lower)) {
    return '后续仍需验证部署边界和失败场景';
  }

  return TYPE_FALLBACK_BULLETS[type][0];
}

function compactUnique(items: Array<string | undefined>, limit: number): string[] {
  const result: string[] = [];
  items.forEach((item) => {
    const compact = compactChineseBullet(item);
    if (!compact || result.includes(compact)) {
      return;
    }
    result.push(compact);
  });
  return result.slice(0, limit);
}

function compactChineseBullet(text?: string): string | undefined {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return undefined;
  }
  const normalized = cleaned
    .replace(/[，,。.;；:：]+$/u, '')
    .replace(/\s*\(p\.\s*\d+\)\s*$/iu, '')
    .trim();
  if (asciiRatio(normalized) > 0.58 && normalized.length > 30) {
    return '原文信息已压缩为中文汇报要点';
  }
  return truncateText(normalized, 42);
}

function buildSourceFooter(slide: PresentationSlide, figure?: PresentationFigureCandidate): string {
  const refs = slide.sourceRefs.slice(0, 2).map((ref) => `p. ${ref.pageNumber} · ${cleanText(ref.section) ?? 'PDF'}`);
  if (refs.length > 0) {
    return refs.join('  |  ');
  }
  if (figure) {
    return `p. ${figure.pageNumber} · ${truncateText(figure.caption, 80)}`;
  }
  return '';
}

function buildSpeakerNotes(slide: PresentationSlide, bullets: string[], visual: PptxSlideVisualPlan): string {
  const lines = [
    cleanText(slide.speakerNotes) ?? '用自己的话解释本页核心逻辑，不照读原文。',
    `本页讲法：${bullets.slice(0, 3).join('；')}。`,
    ...slide.sourceRefs.slice(0, 2).map((ref) => `来源 p. ${ref.pageNumber} · ${ref.section}: ${truncateText(ref.text, 180)}`),
    visual.figure ? `图表来源 p. ${visual.figure.pageNumber}: ${visual.figure.caption}` : ''
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

function getStepHint(type: PresentationSlideType, index: number): string {
  const hints: Record<PresentationSlideType, string[]> = {
    cover: ['论文来源', '汇报目标', '时间控制', '讨论问题'],
    info: ['题目/作者', '研究方向', '来源信息', '核心对象'],
    background: ['为什么重要', '现有瓶颈', '具体场景', '验证目标'],
    relatedWork: ['已有路线', '限制条件', '未解决点', '本文切入'],
    method: ['输入', '编码/建模', '决策/控制', '输出'],
    formula: ['损失项', '约束项', '权重/信号', '训练目标'],
    experiments: ['任务', '对比', '指标', '平台'],
    results: ['主指标', '泛化', '消融', '失败边界'],
    innovation: ['差异', '机制', '证据', '边界'],
    limitations: ['假设', '数据', '部署', '后续'],
    inspiration: ['迁移', 'baseline', '指标', 'idea'],
    summary: ['贡献', '证据', '局限', '行动']
  };
  return hints[type][index] ?? '原文证据';
}

function getCenterNodeLabel(type: PresentationSlideType): string {
  if (type === 'background') return '问题';
  if (type === 'relatedWork') return '缺口';
  if (type === 'method') return '框架';
  if (type === 'formula') return '模块';
  if (type === 'experiments' || type === 'results') return '证据';
  if (type === 'inspiration') return '启发';
  return '论点';
}

function cleanText(text?: string): string | undefined {
  const normalized = text
    ?.replace(/[\u0000-\u001f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized || undefined;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function asciiRatio(text: string): number {
  if (!text) return 0;
  const ascii = text.match(/[A-Za-z]/gu)?.length ?? 0;
  return ascii / text.length;
}

function normalizePptxOutput(output: string | ArrayBuffer | Blob | Uint8Array): ArrayBuffer {
  if (output instanceof ArrayBuffer) {
    return output;
  }
  if (output instanceof Uint8Array) {
    const copy = new Uint8Array(output.byteLength);
    copy.set(output);
    return copy.buffer;
  }
  if (typeof output === 'string') {
    const bytes = new Uint8Array(output.length);
    for (let index = 0; index < output.length; index += 1) {
      bytes[index] = output.charCodeAt(index) & 0xff;
    }
    return bytes.buffer;
  }
  throw new Error('PPTX export returned a Blob; use the browser export path instead.');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('zh-CN');
}
