import pptxgen from 'pptxgenjs';
import type {
  PresentationDraft,
  PresentationFigureCandidate,
  PresentationFigureKind,
  PresentationReviewReport,
  PresentationSlide,
  PresentationSourceRef,
  PresentationSlideType
} from './presentationOutline';

export const SEMINAR_PPT_CANVAS = {
  width: 13.333,
  height: 7.5
} as const;

export const SEMINAR_PPT_TYPOGRAPHY = {
  coverTitle: 27,
  coverSubtitle: 11.5,
  title: 20.5,
  mainPoint: 12.6,
  body: 12.2,
  bodySmall: 10,
  label: 8,
  takeaway: 9,
  source: 7
} as const;

export const SEMINAR_PPT_LAYOUT = {
  takeawayHeight: 0.32
} as const;

export type PptxSlideLayout = 'cover' | 'context' | 'process' | 'figure-focus' | 'comparison' | 'summary' | 'discussion';
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
  background: { title: '研究背景', section: 'BACKGROUND', layout: 'context', visual: 'diagram' },
  relatedWork: { title: '现有方法不足', section: 'GAP', layout: 'comparison', visual: 'diagram' },
  method: { title: '方法框架', section: 'METHOD', layout: 'figure-focus', visual: 'figure' },
  formula: { title: '关键模块或公式', section: 'MODULE', layout: 'process', visual: 'diagram' },
  experiments: { title: '实验设置', section: 'EVALUATION', layout: 'figure-focus', visual: 'table' },
  results: { title: '主要实验结果', section: 'RESULTS', layout: 'figure-focus', visual: 'figure' },
  innovation: { title: '创新点总结', section: 'CONTRIBUTION', layout: 'context', visual: 'diagram' },
  limitations: { title: '局限性与讨论', section: 'LIMITS', layout: 'discussion', visual: 'quote' },
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
  { pattern: /\bPILOT\b/iu, bullet: 'PILOT 聚焦感知移动操作' },
  { pattern: /\bUnitree\s*G1\b/iu, bullet: 'Unitree G1 用于真机验证' },
  { pattern: /\bhumanoid|loco[-\s]?manipulation|whole[-\s]?body\b/iu, bullet: '人形机器人执行移动操作' },
  { pattern: /\breinforcement learning|RL\b/iu, bullet: 'RL 训练低层控制策略' },
  { pattern: /\bperceptive|exteroceptive|terrain|unstructured\b/iu, bullet: '外部感知处理非结构化地形' },
  { pattern: /π0\.?7|pi0\.?7|VLA|VLM|vision[-\s]?language[-\s]?action\b/iu, bullet: 'VLA/VLM 连接指令和动作' },
  { pattern: /\bsubgoal images?|episode metadata|context conditioning\b/iu, bullet: '子目标图像提供上下文' },
  { pattern: /\bdemonstration|autonomous data|multimodal web data|training data\b/iu, bullet: '多源数据支撑策略训练' },
  { pattern: /\bbenchmark|baseline|evaluation|experiment|result\b/iu, bullet: '对比实验验证核心指标' },
  { pattern: /\bablation|robustness|failure|limitation\b/iu, bullet: '消融和失败例说明边界' },
  { pattern: /\bformula|equation|loss|objective|optimization\b/iu, bullet: '公式解释训练目标项' }
];

const FORBIDDEN_GENERIC_LABELS = [
  '论文信息',
  '研究对象',
  '论点',
  '方法线索',
  '汇报目标',
  '结构图对应原文模块链路',
  '策略围绕任务与动作闭环',
  '方法强调模型、控制和执行协同',
  '增强泛化能力',
  '面向复杂场景'
];
const MAX_BULLET_LENGTH = 30;

const SOURCE_SCOPE: Record<PresentationSlideType, { allow: RegExp; deny?: RegExp }> = {
  cover: { allow: /.*/u },
  info: { allow: /abstract|title|info|摘要|基本|论文/iu },
  background: { allow: /abstract|intro|background|motivation|problem|摘要|引言|背景|动机|问题/iu, deny: /result|experiment|evaluation|real[-\s]?world|ablation|结果|实验|评估|真机|消融/iu },
  relatedWork: { allow: /related|prior|literature|intro|background|gap|相关|现有|引言|背景|缺口/iu },
  method: { allow: /method|approach|model|framework|architecture|algorithm|overview|controller|方法|模型|框架|结构|控制器/iu },
  formula: { allow: /formula|equation|objective|loss|optimization|method|公式|方程|目标|损失|优化|方法/iu },
  experiments: { allow: /experiment|evaluation|dataset|benchmark|setting|ablation|simulation|real[-\s]?world|实验|评估|数据集|基准|消融|仿真|真机/iu },
  results: { allow: /result|quantitative|comparison|performance|evaluation|ablation|experiment|结果|对比|性能|评估|消融|实验/iu },
  innovation: { allow: /abstract|method|approach|contribution|conclusion|innovation|摘要|方法|贡献|创新|结论/iu },
  limitations: { allow: /limitation|failure|discussion|conclusion|future|局限|失败|讨论|结论|未来/iu },
  inspiration: { allow: /method|experiment|result|conclusion|future|方法|实验|结果|结论|未来/iu },
  summary: { allow: /abstract|conclusion|summary|摘要|结论|总结/iu }
};

export function buildPptxSlidePlan(draft: PresentationDraft): PptxSlidePlan[] {
  const plan = draft.slides.map((slide, index) => {
    const meta = SLIDE_TYPE_META[slide.type];
    const scopedSlide = withScopedSources(slide);
    const selectedFigures = selectFiguresForSlide(scopedSlide, slide.figures.filter((figure) => figure.selected !== false));
    const visual = buildVisualPlan(scopedSlide, selectedFigures);
    const bullets = buildSeminarBullets(scopedSlide);
    const mainClaim = buildMainClaim(scopedSlide, bullets);
    const sourceFooter = buildSourceFooter(scopedSlide, visual.figure);

    return {
      id: slide.id,
      index,
      layout: meta.layout,
      type: slide.type,
      title: buildSlideTitle(scopedSlide),
      subtitle: scopedSlide.type === 'cover' ? cleanText(scopedSlide.subtitle) ?? draft.subtitle : cleanText(scopedSlide.subtitle),
      section: cleanText(scopedSlide.section) ?? meta.section,
      mainClaim,
      bullets,
      visual,
      figures: selectedFigures,
      sourceFooter,
      speakerNotes: buildSpeakerNotes(scopedSlide, bullets, visual)
    };
  });
  return ensurePlanBulletUniqueness(plan);
}

function ensurePlanBulletUniqueness(plan: PptxSlidePlan[]): PptxSlidePlan[] {
  const seen = new Map<string, number>();
  return plan.map((slide) => {
    const localKeys = new Set<string>();
    const localSemanticKeys = new Set<string>();
    if (slide.type === 'cover') {
      slide.bullets.forEach((bullet) => {
        const key = normalizeBulletForCompare(bullet);
        if (key) {
          seen.set(key, slide.index);
        }
      });
      return slide;
    }

    const uniqueBullets: string[] = [];
    slide.bullets.forEach((bullet) => {
      const key = normalizeBulletForCompare(bullet);
      const semanticKey = getSemanticBulletKey(bullet);
      if (!key || seen.has(key) || localKeys.has(key) || (semanticKey && localSemanticKeys.has(semanticKey))) {
        return;
      }
      seen.set(key, slide.index);
      localKeys.add(key);
      if (semanticKey) {
        localSemanticKeys.add(semanticKey);
      }
      uniqueBullets.push(bullet);
    });

    const candidates = buildSlideSpecificFallbacks(slide);
    const minBulletCount = slide.type === 'info' ? Math.min(1, slide.bullets.length || 1) : 2;
    for (const candidate of candidates) {
      if (uniqueBullets.length >= minBulletCount) {
        break;
      }
      const key = normalizeBulletForCompare(candidate);
      const semanticKey = getSemanticBulletKey(candidate);
      if (!key || seen.has(key) || localKeys.has(key) || (semanticKey && localSemanticKeys.has(semanticKey))) {
        continue;
      }
      seen.set(key, slide.index);
      localKeys.add(key);
      if (semanticKey) {
        localSemanticKeys.add(semanticKey);
      }
      uniqueBullets.push(candidate);
    }

    return {
      ...slide,
      bullets: uniqueBullets.slice(0, 5),
      mainClaim: buildTypedMainClaim(slide.type, uniqueBullets[0] ?? slide.mainClaim)
    };
  });
}

function buildSlideSpecificFallbacks(slide: PptxSlidePlan): string[] {
  const evidence = [slide.mainClaim, ...slide.visual.steps, slide.visual.caption, slide.sourceFooter].join(' ');
  const candidates = [
    summarizeRefAsChinese(slide.type, evidence),
    ...slide.visual.steps.map((step) => buildStepBullet(slide.type, step)),
    slide.visual.figure ? `${getFigureKind(slide.visual.figure)} 图表支撑第 ${slide.visual.figure.pageNumber} 页证据` : undefined
  ];
  return compactUnique(candidates, 5).filter((item) => !hasForbiddenGeneric(item));
}

function buildStepBullet(type: PresentationSlideType, step: string): string | undefined {
  const cleaned = cleanText(step);
  if (!cleaned) return undefined;
  if (type === 'method' || type === 'formula') return `${cleaned} 属于方法链路`;
  if (type === 'experiments') return `${cleaned} 属于实验设置`;
  if (type === 'results') return `${cleaned} 支撑结果判断`;
  if (type === 'innovation') return `${cleaned} 构成设计差异`;
  if (type === 'limitations') return `${cleaned} 暴露方法边界`;
  if (type === 'inspiration') return `${cleaned} 可转为复现线索`;
  if (type === 'summary') return `${cleaned} 是汇报结论线索`;
  return undefined;
}

export function validatePptxSlidePlan(plan: PptxSlidePlan[]): string[] {
  return validatePptxQuality(plan);
}

export function buildPresentationReviewReport(draft: PresentationDraft): PresentationReviewReport {
  const plan = buildPptxSlidePlan(draft);
  const issues = validatePptxQuality(plan);
  const planBullets = plan.flatMap((slide) => slide.bullets);
  const repeatedKeywordProblem = hasRepeatedBulletProblem(planBullets) || hasKeywordStuffingProblem(planBullets);
  const genericTemplateProblem = hasGenericTemplateProblem(plan);
  const slideTypeMismatch = hasSlideTypeMismatch(plan, draft);
  const figureMismatch = hasFigureMismatch(plan);
  const methodCapability = evaluateMethodCapability(draft, plan);
  const failedSlides = buildFailedSlideReport(plan, {
    repeatedKeywordProblem,
    genericTemplateProblem,
    slideTypeMismatch,
    figureMismatch
  });
  const allIssues = compactStringList(
    [
      ...issues,
      repeatedKeywordProblem ? '存在跨页重复关键词或 noun-phrase stuffing。' : '',
      genericTemplateProblem ? '存在通用模板化内容或占位图。' : '',
      slideTypeMismatch ? '存在页面类型与内容不匹配。' : '',
      figureMismatch ? '存在图表类型与页面不匹配。' : '',
      ...methodCapability.issues
    ],
    80
  );

  const passed =
    allIssues.length === 0 &&
    methodCapability.can_explain_method_from_ppt_only &&
    !repeatedKeywordProblem &&
    !genericTemplateProblem &&
    !slideTypeMismatch &&
    !figureMismatch;

  return {
    passed,
    can_explain_method_from_ppt_only: methodCapability.can_explain_method_from_ppt_only,
    can_identify_core_problem: methodCapability.can_identify_core_problem,
    can_identify_method_stages: methodCapability.can_identify_method_stages,
    can_identify_stage_inputs: methodCapability.can_identify_stage_inputs,
    can_identify_stage_outputs: methodCapability.can_identify_stage_outputs,
    can_identify_stage_connections: methodCapability.can_identify_stage_connections,
    can_identify_training_or_implementation: methodCapability.can_identify_training_or_implementation,
    can_identify_evaluation_logic: methodCapability.can_identify_evaluation_logic,
    repeated_keyword_problem: repeatedKeywordProblem,
    generic_template_problem: genericTemplateProblem,
    slide_type_mismatch: slideTypeMismatch,
    figure_mismatch: figureMismatch,
    failed_slides: failedSlides,
    issues: allIssues,
    auto_revisions: 0,
    remaining_risks: passed ? [] : ['请重新生成或使用 AI 增强大纲；导出前必须让方法链路、来源和图表匹配通过。']
  };
}

export function validatePptxQuality(plan: PptxSlidePlan[]): string[] {
  const issues: string[] = [];

  if (plan.length < 8) {
    issues.push('PPT 页数过少，无法形成完整组会叙事。');
  }

  if (SEMINAR_PPT_TYPOGRAPHY.title > 22) {
    issues.push('普通页标题字号超过 22 pt。');
  }
  if (SEMINAR_PPT_TYPOGRAPHY.body > 13.5) {
    issues.push('普通页正文字号超过 13.5 pt。');
  }
  if (SEMINAR_PPT_LAYOUT.takeawayHeight > 0.35) {
    issues.push('本页小结高度超过 0.35 inch。');
  }

  plan.forEach((slide) => {
    const metaTitle = SLIDE_TYPE_META[slide.type].title;
    if (!slide.title.trim()) {
      issues.push(`第 ${slide.index + 1} 页缺少标题。`);
    }
    if (slide.type !== 'cover' && slide.title !== metaTitle) {
      issues.push(`第 ${slide.index + 1} 页标题与 slide type 不匹配。`);
    }
    if (slide.type !== 'cover' && !slide.sourceFooter.includes('p.')) {
      issues.push(`第 ${slide.index + 1} 页缺少可追溯页码来源。`);
    }
    if (slide.type === 'background' && /result|experiment|real[-\s]?world|Results|Experiments|真机|实验|结果/iu.test(slide.sourceFooter)) {
      issues.push(`第 ${slide.index + 1} 页背景来源混入实验或结果章节。`);
    }
    if (!slide.speakerNotes.trim()) {
      issues.push(`第 ${slide.index + 1} 页缺少讲稿备注。`);
    }
    if (slide.visual.steps.some((step) => FORBIDDEN_GENERIC_LABELS.includes(step))) {
      issues.push(`第 ${slide.index + 1} 页包含通用占位结构图标签。`);
    }
    if (
      slide.type !== 'cover' &&
      slide.type !== 'info' &&
      slide.bullets.length > 0 &&
      slide.bullets.filter((bullet) => isWeakNounPhraseBullet(bullet)).length / slide.bullets.length > 0.5
    ) {
      issues.push(`第 ${slide.index + 1} 页存在只有名词堆叠、缺少解释价值的 bullet。`);
    }
    if (slide.type === 'method' && !hasMethodEvidence(slide)) {
      issues.push(`第 ${slide.index + 1} 页方法页缺少方法相关 bullet 或结构图。`);
    }
    if (slide.type === 'method' && !hasInputProcessOutputEvidence(slide)) {
      issues.push(`第 ${slide.index + 1} 页方法页没有讲清 input / process / output / connection。`);
    }
    if ((slide.type === 'experiments' || slide.type === 'results') && countExperimentEvidenceCategories(slide) < 2) {
      issues.push(`第 ${slide.index + 1} 页实验/结果页缺少 baseline、metric、result 中至少两类信息。`);
    }
    if (!['cover', 'info'].includes(slide.type) && slide.bullets.filter((bullet) => hasChineseText(bullet)).length < 2) {
      issues.push(`第 ${slide.index + 1} 页中文 bullet 少于 2 条。`);
    }
    if (slide.bullets.length > 5) {
      issues.push(`第 ${slide.index + 1} 页要点超过 5 条。`);
    }
    slide.bullets.forEach((bullet, bulletIndex) => {
      if (bullet.length > MAX_BULLET_LENGTH) {
        issues.push(`第 ${slide.index + 1} 页第 ${bulletIndex + 1} 条要点过长。`);
      }
      if (asciiRatio(bullet) >= 0.7) {
        issues.push(`第 ${slide.index + 1} 页第 ${bulletIndex + 1} 条仍像英文原文。`);
      }
    });
  });

  collectRepeatedBulletIssues(plan).forEach((issue) => issues.push(issue));

  plan.forEach((slide) => {
    const bySemanticKey = new Map<string, string[]>();
    slide.bullets.forEach((bullet) => {
      const key = getSemanticBulletKey(bullet);
      if (!key) {
        return;
      }
      bySemanticKey.set(key, [...(bySemanticKey.get(key) ?? []), bullet]);
    });
    bySemanticKey.forEach((items) => {
      if (items.length >= 2) {
        issues.push(`semantic duplicate on slide ${slide.index + 1}: ${items[0]}`);
      }
    });
  });
  return issues;
}

function evaluateMethodCapability(
  draft: PresentationDraft,
  plan: PptxSlidePlan[]
): Pick<
  PresentationReviewReport,
  | 'can_explain_method_from_ppt_only'
  | 'can_identify_core_problem'
  | 'can_identify_method_stages'
  | 'can_identify_stage_inputs'
  | 'can_identify_stage_outputs'
  | 'can_identify_stage_connections'
  | 'can_identify_training_or_implementation'
  | 'can_identify_evaluation_logic'
> & { issues: string[] } {
  const methodMap = draft.methodMap;
  const methodPlanText = plan
    .filter((slide) => slide.type === 'method' || slide.type === 'formula')
    .map((slide) => [slide.mainClaim, ...slide.bullets, ...slide.visual.steps, slide.visual.caption].join(' '))
    .join(' ');
  const draftMethodText = draft.slides
    .filter((slide) => slide.type === 'method' || slide.type === 'formula')
    .map((slide) => [...slide.bullets, ...slide.sourceRefs.map((ref) => ref.text)].join(' '))
    .join(' ');
  const combined = `${methodPlanText} ${draftMethodText}`;
  const stages = methodMap?.method_stages ?? [];
  const canIdentifyCoreProblem = Boolean(methodMap?.core_problem) || /problem|challenge|lack|瓶颈|困难|不足|unstructured|loco[-\s]?manipulation/iu.test(combined);
  const canIdentifyInputs =
    stages.some((stage) => hasConcreteValue(stage.input)) ||
    /input|observation|LiDAR|elevation map|proprioceptive|language instruction|视觉|感知|输入/iu.test(combined);
  const canIdentifyOutputs =
    stages.some((stage) => hasConcreteValue(stage.output)) ||
    /output|action|control command|whole[-\s]?body|动作|控制输出|输出/iu.test(combined);
  const canIdentifyConnections =
    stages.some((stage) => hasConcreteValue(stage.connects_to_next)) ||
    /connect|condition|representation|→|->|驱动|连接|交给|闭环/iu.test(combined);
  const canIdentifyTraining =
    Boolean(methodMap?.training_or_implementation && !/原文未明确说明/u.test(methodMap.training_or_implementation)) ||
    /training|reinforcement learning|objective|loss|optimization|训练|目标|实现/iu.test(combined);
  const canIdentifyEvaluation =
    Boolean(methodMap?.evaluation_logic && !/原文未明确说明/u.test(methodMap.evaluation_logic)) ||
    /experiment|evaluate|baseline|metric|success|tracking|stability|Unitree|实验|指标|对比|结果/iu.test(combined);
  const canIdentifyStages =
    stages.length >= 3 ||
    (plan.some((slide) => slide.type === 'method' && slide.visual.steps.length >= 4) &&
      canIdentifyInputs &&
      canIdentifyOutputs &&
      canIdentifyConnections);
  const genericMethodProblem =
    /does not explain input, process, output/i.test(draftMethodText) ||
    plan.some((slide) => slide.type === 'method' && slide.visual.kind === 'diagram' && slide.visual.steps.some((step) => isGenericMethodStep(step)));
  const canExplain =
    canIdentifyCoreProblem &&
    canIdentifyStages &&
    canIdentifyInputs &&
    canIdentifyOutputs &&
    canIdentifyConnections &&
    canIdentifyTraining &&
    canIdentifyEvaluation &&
    !genericMethodProblem;
  const issues = compactStringList(
    [
      canIdentifyCoreProblem ? '' : 'PPT 无法识别核心问题。',
      canIdentifyStages ? '' : 'PPT 无法识别方法阶段。',
      canIdentifyInputs ? '' : '方法页没有明确输入。',
      canIdentifyOutputs ? '' : '方法页没有明确输出。',
      canIdentifyConnections ? '' : '方法页没有明确阶段连接。',
      canIdentifyTraining ? '' : 'PPT 缺少训练或实现逻辑。',
      canIdentifyEvaluation ? '' : 'PPT 缺少评估逻辑。',
      genericMethodProblem ? '方法图或方法页仍像通用模板。' : ''
    ],
    20
  );

  return {
    can_explain_method_from_ppt_only: canExplain,
    can_identify_core_problem: canIdentifyCoreProblem,
    can_identify_method_stages: canIdentifyStages && !genericMethodProblem,
    can_identify_stage_inputs: canIdentifyInputs,
    can_identify_stage_outputs: canIdentifyOutputs,
    can_identify_stage_connections: canIdentifyConnections,
    can_identify_training_or_implementation: canIdentifyTraining,
    can_identify_evaluation_logic: canIdentifyEvaluation,
    issues
  };
}

function hasRepeatedBulletProblem(bullets: string[]): boolean {
  const normalized = bullets.map(normalizeBulletForCompare).filter(Boolean);
  const counts = new Map<string, number>();
  normalized.forEach((bullet) => counts.set(bullet, (counts.get(bullet) ?? 0) + 1));
  if ([...counts.values()].some((count) => count >= 2)) {
    return true;
  }

  const fuzzyHits = new Map<string, number>();
  normalized.forEach((bullet, index) => {
    let similar = 0;
    normalized.forEach((other, otherIndex) => {
      if (index !== otherIndex && similarityScore(bullet, other) > 0.82) {
        similar += 1;
      }
    });
    if (similar > 0) {
      fuzzyHits.set(bullet, similar + 1);
    }
  });
  return [...fuzzyHits.values()].some((count) => count >= 3);
}

function hasKeywordStuffingProblem(bullets: string[]): boolean {
  const useful = bullets.map((bullet) => cleanText(bullet) ?? '').filter(Boolean);
  if (useful.length < 4) {
    return false;
  }
  const weakCount = useful.filter((bullet) => isWeakNounPhraseBullet(bullet)).length;
  return weakCount / useful.length > 0.5;
}

function hasGenericTemplateProblem(plan: PptxSlidePlan[]): boolean {
  const planText = plan.map((slide) => [slide.mainClaim, ...slide.bullets, ...slide.visual.steps].join(' ')).join(' ');
  return hasForbiddenGeneric(planText) || /论文信息|研究对象|论点|方法线索|汇报目标/u.test(planText);
}

function hasSlideTypeMismatch(plan: PptxSlidePlan[], draft: PresentationDraft): boolean {
  const info = draft.slides.find((slide) => slide.type === 'info');
  if (info && countMethodTermsInInfo(info.bullets.join(' ')) >= 2) {
    return true;
  }
  return plan.some((slide) => {
    if (slide.type === 'background') {
      return /result|experiment|real[-\s]?world|Results|Experiments|真机|实验|结果/iu.test(slide.sourceFooter);
    }
    if (slide.type === 'info') {
      return countMethodTermsInInfo(slide.bullets.join(' ')) >= 2;
    }
    return false;
  });
}

function countMethodTermsInInfo(text: string): number {
  const cleaned = text.replace(/英文标题|作者|来源|会议|年份|title|author|source/giu, '');
  const terms = [
    /VLA|VLM/iu,
    /subgoal|episode metadata|language instruction/iu,
    /LiDAR/iu,
    /whole[-\s]?body|hybrid internal command/iu,
    /policy|training|动作|策略|控制/iu
  ];
  return terms.reduce((count, pattern) => count + (pattern.test(cleaned) ? 1 : 0), 0);
}

function hasFigureMismatch(plan: PptxSlidePlan[]): boolean {
  return plan.some((slide) => {
    const kind = getFigureKind(slide.visual.figure);
    if (slide.type === 'results') {
      return kind === 'setup' || kind === 'method';
    }
    if (slide.type === 'method') {
      return kind === 'setup' || kind === 'result';
    }
    return false;
  });
}

function buildFailedSlideReport(
  plan: PptxSlidePlan[],
  flags: {
    repeatedKeywordProblem: boolean;
    genericTemplateProblem: boolean;
    slideTypeMismatch: boolean;
    figureMismatch: boolean;
  }
): PresentationReviewReport['failed_slides'] {
  const failed: PresentationReviewReport['failed_slides'] = [];
  plan.forEach((slide) => {
    if (slide.type === 'method' && !hasInputProcessOutputEvidence(slide)) {
      failed.push({ index: slide.index, type: slide.type, reason: '方法页缺少 input/process/output/connection。' });
    }
    if (slide.type === 'background' && /result|experiment|real[-\s]?world|Results|Experiments|真机|实验|结果/iu.test(slide.sourceFooter)) {
      failed.push({ index: slide.index, type: slide.type, reason: '背景页来源混入实验/结果。' });
    }
    if (slide.type === 'results') {
      const hasSetupFigure = slide.figures.some((figure) => getFigureKind(figure) === 'setup');
      if (hasSetupFigure) {
        failed.push({ index: slide.index, type: slide.type, reason: '结果页使用了 setup/task/robot 示例图。' });
      }
    }
  });
  if (flags.repeatedKeywordProblem) {
    failed.push({ index: -1, type: 'summary', reason: '跨页重复关键词或 noun phrase stuffing。' });
  }
  if (flags.genericTemplateProblem) {
    failed.push({ index: -1, type: 'method', reason: '仍含通用占位模板内容。' });
  }
  if (flags.slideTypeMismatch) {
    failed.push({ index: -1, type: 'info', reason: '页面类型与内容不匹配。' });
  }
  if (flags.figureMismatch) {
    failed.push({ index: -1, type: 'results', reason: '图表类型与页面不匹配。' });
  }
  return failed;
}

function collectRepeatedBulletIssues(plan: PptxSlidePlan[]): string[] {
  const bullets = plan.flatMap((slide) => slide.bullets.map((bullet) => ({ slide, bullet })));
  const normalized = bullets.map((item) => ({ ...item, key: normalizeBulletForCompare(item.bullet) })).filter((item) => item.key);
  const byKey = new Map<string, typeof normalized>();
  normalized.forEach((item) => {
    byKey.set(item.key, [...(byKey.get(item.key) ?? []), item]);
  });
  const issues: string[] = [];
  byKey.forEach((items) => {
    if (items.length >= 2) {
      issues.push(`重复 bullet：${items[0].bullet}`);
    }
  });
  return issues;
}

function hasInputProcessOutputEvidence(slide: PptxSlidePlan): boolean {
  const evidence = [slide.mainClaim, ...slide.bullets, ...slide.visual.steps, slide.visual.caption, slide.sourceFooter].join(' ');
  const hasInput = /input|observation|LiDAR|elevation map|proprioceptive|language instruction|视觉|感知|输入/iu.test(evidence);
  const hasProcess = /policy|controller|model|VLA|VLM|RL|condition|representation|process|策略|模型|控制器|训练|表示/iu.test(evidence);
  const hasOutput = /output|action|command|control|whole[-\s]?body|动作|命令|输出/iu.test(evidence);
  const hasConnection = /connect|condition|representation|→|->|驱动|连接|交给|闭环/iu.test(evidence);
  return hasInput && hasProcess && hasOutput && hasConnection;
}

function isWeakNounPhraseBullet(bullet: string): boolean {
  const text = normalizeBulletForCompare(bullet);
  if (!text) {
    return false;
  }
  const hasVerbOrExplanation = /是|来自|检查|需要|要求|缺少|破坏|依赖|仍有|难以|补足|接入|解决|输入|输出|连接|驱动|训练|验证|比较|提升|降低|说明|产生|用于|作为|映射|约束|完成|执行|支撑|关注|覆盖|检验|调节|描述|面向|聚焦|包含|体现|衡量|evaluate|compare|output|input|train|connect|improve|reduce/iu.test(text);
  const terms = text.match(/[A-Za-z0-9π.-]+|[\u4e00-\u9fff]{2,}/gu) ?? [];
  return terms.length <= 6 && !hasVerbOrExplanation;
}

function isGenericMethodStep(step: string): boolean {
  return /语言\/视觉上下文|VLA 策略模型|子目标图像|动作输出|多源数据训练|外部感知|RL 低层控制器|全身运动策略|机器人动作输出|稳定性目标/u.test(step);
}

function normalizeBulletForCompare(text: string): string {
  return (cleanText(text) ?? '')
    .replace(/（p\.\s*\d+）/giu, '')
    .replace(/\(p\.\s*\d+\)/giu, '')
    .replace(/[，。；;:：,.!?！？、\s]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function getSemanticBulletKey(text: string): string {
  const normalized = normalizeBulletForCompare(text);
  if (!normalized) {
    return '';
  }

  const topics: Array<[RegExp, string]> = [
    [/π0\.?7|蟺0\.?7|pi0\.?7/iu, 'pi0.7'],
    [/\blanguage (instruction|instructions|command|commands|goal|goals)\b/iu, 'language-instruction'],
    [/\bsubgoal images?\b|子目标/u, 'subgoal-images'],
    [/\bepisode metadata\b|元数据/u, 'episode-metadata'],
    [/\bcontext conditioning\b|上下文/u, 'context-conditioning'],
    [/\blong[-\s]?horizon\b|长程/u, 'long-horizon'],
    [/\bVLA\b|\bVLM\b|vision[-\s]?language[-\s]?action/iu, 'vla-vlm'],
    [/\bLiDAR\b|elevation map|地形图/u, 'lidar-elevation'],
    [/\bhybrid internal command\b|混合内部/u, 'hybrid-command'],
    [/\bwhole[-\s]?body actions?\b|全身动作/u, 'whole-body-action'],
    [/\bUnitree\s*G1\b/iu, 'unitree-g1'],
    [/\bbaseline|benchmark|comparison\b|基线|对比/u, 'baseline-comparison'],
    [/\btracking|stability|success rate|metric|rate\b|指标|稳定/u, 'metrics'],
    [/\breinforcement learning\b|\bRL\b|训练/u, 'rl-training'],
    [/\bterrain|unstructured|scene|environment\b|非结构|地形/u, 'terrain-scene']
  ];

  return topics.find(([pattern]) => pattern.test(normalized))?.[1] ?? '';
}

function similarityScore(a: string, b: string): number {
  const aSet = new Set(a.split(/\s+/u).filter(Boolean));
  const bSet = new Set(b.split(/\s+/u).filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) {
    return 0;
  }
  const intersection = [...aSet].filter((item) => bSet.has(item)).length;
  return (2 * intersection) / (aSet.size + bSet.size);
}

function compactStringList(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  items.forEach((item) => {
    const normalized = cleanText(item);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result.slice(0, limit);
}

function hasConcreteValue(text: string): boolean {
  return Boolean(cleanText(text)) && !/原文未明确说明|未找到|unknown/i.test(text);
}

function getFigureKind(figure?: PresentationFigureCandidate): PresentationFigureKind {
  if (!figure) {
    return 'unknown';
  }
  if (figure.figureKind) {
    return figure.figureKind;
  }
  const caption = cleanText(figure.caption) ?? '';
  if (/result|quantitative|comparison|performance|ablation|success\s*rate|tracking|stability|benchmark|evaluation|metric|score|accuracy|table/iu.test(caption)) {
    return 'result';
  }
  if (/architecture|overview|framework|pipeline|method|model|algorithm|system|module|process|controller|policy/iu.test(caption)) {
    return 'method';
  }
  if (/robot|platform|task|environment|dataset|setup|illustration|example|demonstration|scene/iu.test(caption)) {
    return 'setup';
  }
  if (/loss|equation|formula|objective|optimization|gradient/iu.test(caption)) {
    return 'formula';
  }
  if (/failure|case|qualitative|visualization/iu.test(caption)) {
    return 'case';
  }
  return 'unknown';
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
  const reviewReport = buildPresentationReviewReport(draft);
  if (!reviewReport.passed) {
    throw new Error(`质量检查未通过，请重新生成。\n${reviewReport.issues.join('\n')}`);
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
  const hasDiagram = plan.visual.kind === 'diagram' && plan.visual.steps.length >= 4;
  drawBulletList(slide, plan.bullets, 0.88, 2.15, hasDiagram ? 6.65 : 10.9, 2.85);
  if (hasDiagram) {
    drawCompactSchematic(pptx, slide, plan, 8.15, 1.35, 4.15, 3.85);
  }
  drawTakeawayStrip(slide, plan, 0.72, 5.72, 11.7, SEMINAR_PPT_LAYOUT.takeawayHeight);
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
      fontSize: SEMINAR_PPT_TYPOGRAPHY.body,
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
      fontSize: SEMINAR_PPT_TYPOGRAPHY.body,
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
      w: 0.1,
      h: 0.1,
      fill: { color: COLOR.accent },
      line: { color: COLOR.accent }
    });
    slide.addText(bullet, {
      x: x + 0.28,
      y: itemY,
      w,
      h: compact ? 0.27 : 0.34,
      fontSize: compact ? SEMINAR_PPT_TYPOGRAPHY.bodySmall : SEMINAR_PPT_TYPOGRAPHY.body,
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
    fontSize: SEMINAR_PPT_TYPOGRAPHY.bodySmall,
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
  const imageData = getFigureImageData(plan.visual.figure);
  if (imageData) {
    drawFigureImage(slide, plan, imageData, x, y, w, h);
    return;
  }

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

function drawFigureImage(
  slide: pptxgen.Slide,
  plan: PptxSlidePlan,
  imageData: string,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  slide.addShape('rect', {
    x,
    y,
    w,
    h,
    fill: { color: 'FFFFFF' },
    line: { color: 'CBD5E1', width: 0.8, transparency: 10 }
  });

  const cropBox = plan.visual.figure?.cropBox;
  const aspectRatio = cropBox && cropBox.height > 0 ? cropBox.width / cropBox.height : 1.4;
  const imageFrame = fitRectIntoBox(aspectRatio, x + 0.12, y + 0.12, w - 0.24, h - 0.24);
  slide.addImage({
    data: imageData,
    x: imageFrame.x,
    y: imageFrame.y,
    w: imageFrame.w,
    h: imageFrame.h
  });
}

function getFigureImageData(figure?: PresentationFigureCandidate): string | null {
  if (!figure?.imageDataUrl || !/^data:image\/(png|jpeg|jpg);base64,/iu.test(figure.imageDataUrl)) {
    return null;
  }
  return figure.imageDataUrl;
}

function fitRectIntoBox(
  aspectRatio: number,
  x: number,
  y: number,
  w: number,
  h: number
): { x: number; y: number; w: number; h: number } {
  const boxRatio = w / h;
  if (aspectRatio >= boxRatio) {
    const imageHeight = w / aspectRatio;
    return {
      x,
      y: y + (h - imageHeight) / 2,
      w,
      h: imageHeight
    };
  }

  const imageWidth = h * aspectRatio;
  return {
    x: x + (w - imageWidth) / 2,
    y,
    w: imageWidth,
    h
  };
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
    fontSize: SEMINAR_PPT_TYPOGRAPHY.takeaway,
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
      fontSize: 10.5,
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
    fill: { color: COLOR.accentSoft },
    line: { color: 'D9DEE8', width: 0.55 }
  });
  slide.addText(`本页小结  ${truncateText(plan.mainClaim, 24)}`, {
    x: x + 0.18,
    y: y + 0.08,
    w: w - 0.44,
    h: 0.18,
    fontSize: SEMINAR_PPT_TYPOGRAPHY.takeaway,
    bold: true,
    color: COLOR.text,
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
      fontSize: 12.5,
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

function withScopedSources(slide: PresentationSlide): PresentationSlide {
  const scopedRefs = getScopedSourceRefs(slide);
  if (scopedRefs.length === 0 || scopedRefs.length === slide.sourceRefs.length) {
    return slide;
  }
  return {
    ...slide,
    sourceRefs: scopedRefs
  };
}

function getScopedSourceRefs(slide: PresentationSlide): PresentationSourceRef[] {
  const scope = SOURCE_SCOPE[slide.type];
  const refs = slide.sourceRefs.filter((ref) => {
    const section = cleanText(ref.section) ?? '';
    const text = cleanText(ref.text) ?? '';
    const haystack = `${section} ${text}`;
    if (scope.deny?.test(haystack)) {
      return false;
    }
    return scope.allow.test(haystack);
  });
  return refs.length > 0 ? refs : slide.sourceRefs;
}

function selectFiguresForSlide(slide: PresentationSlide, figures: PresentationFigureCandidate[]): PresentationFigureCandidate[] {
  return figures
    .map((figure) => ({ figure, score: scoreFigureForSlide(slide, figure) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.figure)
    .slice(0, 2);
}

function scoreFigureForSlide(slide: PresentationSlide, figure: PresentationFigureCandidate): number {
  const caption = cleanText(figure.caption) ?? '';
  const captionLower = caption.toLowerCase();
  const sourceText = getSlideEvidenceText(slide).toLowerCase();
  const figureKind = getFigureKind(figure);
  let score = figure.suggestedSlide === slide.type ? 6 : 0;

  if (slide.type === 'method' || slide.type === 'formula') {
    if (figureKind === 'setup' || figureKind === 'result') return 0;
    if (/architecture|overview|framework|method|model|controller|policy|pipeline|system/i.test(captionLower)) score += 5;
    if (/fig\.|figure/i.test(captionLower)) score += 2;
    if (/result|ablation|benchmark|table/i.test(captionLower)) score -= 3;
  } else if (slide.type === 'results') {
    if (figureKind !== 'result') return 0;
    if (/result|experiment|evaluation|benchmark|ablation|comparison|table/i.test(captionLower)) score += 5;
    if (/architecture|overview|method|framework|robot platform|task examples/i.test(captionLower)) score -= 4;
  } else if (slide.type === 'experiments') {
    if (figureKind === 'method') return 0;
    if (/result|experiment|evaluation|benchmark|ablation|comparison|table/i.test(captionLower)) score += 5;
    if (/robot|platform|task|environment|dataset|setup|example/i.test(captionLower)) score += 4;
    if (/architecture|overview|method|framework/i.test(captionLower)) score -= 2;
  } else {
    score += 1;
  }

  if (figure.pageNumber > 0 && sourceText.includes(String(figure.pageNumber))) {
    score += 1;
  }
  if (/references|bibliography/i.test(captionLower)) {
    score -= 8;
  }
  return score;
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
  const directBullets = slide.bullets
    .map((bullet) => summarizeDirectSlideBullet(slide.type, bullet))
    .filter(Boolean);
  const specificBullets = filterKeywordBulletsForType(slide.type, extractSpecificBullets(slide, sourceText));
  const keywordBullets = filterKeywordBulletsForType(
    slide.type,
    KEYWORD_BULLETS.filter((item) => item.pattern.test(sourceText)).map((item) => item.bullet)
  );
  const typeBullets = specificBullets.length >= 2 || slide.sourceRefs.length > 0 ? [] : TYPE_FALLBACK_BULLETS[slide.type];
  const derivedBullets = slide.sourceRefs
    .slice(0, 3)
    .map((ref) => summarizeRefAsChinese(slide.type, ref.text))
    .filter(Boolean);

  const primary = compactUnique([...directBullets, ...specificBullets, ...keywordBullets, ...derivedBullets, ...typeBullets].filter(isAllowedSeminarBullet), 5);
  if (slide.type !== 'info' && primary.length < 2 && slide.sourceRefs.length === 0) {
    return compactUnique([...primary, ...TYPE_FALLBACK_BULLETS[slide.type]], 5);
  }
  return primary;
}

function summarizeDirectSlideBullet(type: PresentationSlideType, bullet: string): string | undefined {
  const cleaned = cleanText(bullet);
  if (!cleaned) {
    return undefined;
  }
  if (type === 'info' && /^来源[:：]/u.test(cleaned)) {
    return cleaned.replace(/IEEE Robotics/iu, 'IEEE 机器人方向').replace(/Robotics/iu, '机器人方向');
  }
  if (asciiRatio(cleaned) > 0.58 && !/[=+*/^_{}]/u.test(cleaned)) {
    return summarizeRefAsChinese(type, cleaned) ?? summarizeEnglishLikeBullet(cleaned);
  }
  return compactChineseBullet(cleaned);
}

function filterKeywordBulletsForType(type: PresentationSlideType, bullets: string[]): string[] {
  const allow: Record<PresentationSlideType, RegExp> = {
    cover: /组会|汇报/u,
    info: /论文|作者|来源/u,
    background: /瓶颈|场景|地形|任务|泛化|unstructured|humanoid|loco|π0\.7|language|subgoal|metadata|context|long-horizon/u,
    relatedWork: /baseline|现有|瓶颈|场景|泛化|unstructured|limited|lack|cannot/u,
    method: /PILOT|LiDAR|language|hybrid|whole-body|RL|VLA|VLM|subgoal|metadata|context|动作|训练|策略|控制/u,
    formula: /公式|目标|loss|objective|训练/u,
    experiments: /Unitree|仿真|真实|baseline|benchmark|任务|平台|实验|指标/u,
    results: /Unitree|baseline|benchmark|success|tracking|stability|ablation|robustness|指标|结果|泛化/u,
    innovation: /PILOT|LiDAR|hybrid|context|subgoal|VLA|贡献|差异/u,
    limitations: /failure|limitation|ablation|robustness|失败|边界/u,
    inspiration: /baseline|指标|RL|PINN|CBF|MPC|可复用/u,
    summary: /PILOT|π0\.7|Unitree|baseline|指标|总结|复现/u
  };
  return bullets.filter((bullet) => allow[type].test(bullet));
}

function extractSpecificBullets(slide: PresentationSlide, sourceText: string): string[] {
  const bullets: string[] = [];
  const lower = sourceText.toLowerCase();

  if (/\bPILOT\b/iu.test(sourceText)) bullets.push('PILOT 闭环连接感知和低层控制');
  if (/π0\.?7|pi0\.?7\b/iu.test(sourceText)) bullets.push('π0.7 通过 context conditioning 调节策略');
  if (/\bLiDAR[-\s]?based elevation maps?\b/iu.test(sourceText)) bullets.push('LiDAR 地形图提供外部感知');
  if (/\blanguage (instructions?|goals?|commands?)\b/iu.test(sourceText)) bullets.push('language instruction 作为策略输入');
  if (/\bhybrid internal command(?: representation)?\b/iu.test(sourceText)) bullets.push('混合内部命令连接任务意图');
  if (/\bwhole[-\s]?body actions?\b/iu.test(sourceText)) bullets.push('全身动作作为控制输出');
  if (/\bL\s*=\s*L_/iu.test(sourceText)) bullets.push(extractFormulaBullet(sourceText));
  if (/\bUnitree\s*G1\b/iu.test(sourceText)) bullets.push('Unitree G1 完成真机验证');
  if (/\bhumanoid|whole[-\s]?body|loco[-\s]?manipulation\b/iu.test(sourceText)) bullets.push('人形机器人执行移动操作任务');
  if (/\bRL|reinforcement learning\b/iu.test(sourceText)) bullets.push('强化学习训练低层控制策略');
  if (/\bVLA|VLM|vision[-\s]?language[-\s]?action\b/iu.test(sourceText)) bullets.push('VLA/VLM 连接指令与动作');
  if (/\bsubgoal images?|episode metadata\b/iu.test(sourceText)) bullets.push('子目标图像约束执行策略');
  if (/\bsubgoal images?\b/iu.test(sourceText)) bullets.push('子目标图像提供阶段目标');
  if (/\bepisode metadata\b/iu.test(sourceText)) bullets.push('回合元数据描述任务上下文');
  if (/\bcontext conditioning\b/iu.test(sourceText)) bullets.push('context conditioning 约束模型行为');
  if (/\blong[-\s]?horizon tasks?\b/iu.test(sourceText)) bullets.push('long-horizon tasks 检验组合执行');
  if (/\bcross[-\s]?embodiment\b/iu.test(sourceText)) bullets.push('cross-embodiment 测试迁移能力');
  if (/\bdemonstration|autonomous data|multimodal web data\b/iu.test(sourceText)) bullets.push('多源数据支持策略训练');
  if (/\bbaseline|benchmark|comparison\b/iu.test(sourceText)) bullets.push('基线对比支撑结论');
  if (/\bsuccess|tracking|stability|collision|metric|rate\b/iu.test(sourceText)) bullets.push('指标覆盖成功率和稳定性');
  if (/\bterrain|unstructured|scene\b/iu.test(sourceText)) bullets.push('非结构化地形暴露控制瓶颈');

  if (slide.type === 'method' || slide.type === 'formula') {
    if (/\binput|observation|vision|perception|exteroceptive\b/u.test(lower)) bullets.push('输入侧包含外部感知观测');
    if (/\boutput|action|command|control\b/u.test(lower)) bullets.push('输出侧直接服务机器人动作');
  }
  if (slide.type === 'experiments' || slide.type === 'results') {
    if (/\bsimulation|sim[-\s]?to[-\s]?real|real[-\s]?world\b/u.test(lower)) bullets.push('实验覆盖仿真与真实场景');
    if (/\bablation|generalization|robustness\b/u.test(lower)) bullets.push('消融验证泛化和鲁棒性');
  }

  return bullets;
}

function isAllowedSeminarBullet(item: string | undefined): item is string {
  const cleaned = cleanText(item);
  if (!cleaned) {
    return false;
  }
  return !hasForbiddenGeneric(cleaned);
}

function buildMainClaim(slide: PresentationSlide, bullets: string[]): string {
  if (slide.type === 'cover') {
    return '围绕问题、方法、证据和启发组织组会汇报';
  }
  const evidence = bullets[0] ?? TYPE_FALLBACK_BULLETS[slide.type][0] ?? '原文未明确说明';
  return buildTypedMainClaim(slide.type, evidence);
}

function buildTypedMainClaim(type: PresentationSlideType, evidence: string): string {
  const compact = truncateText(cleanText(evidence) ?? '原文未明确说明', 22);
  switch (type) {
    case 'info':
      return `本页交代论文来源：${compact}`;
    case 'background':
      return `本页聚焦问题来源：${compact}`;
    case 'relatedWork':
      return `本页说明现有缺口：${compact}`;
    case 'method':
      return `本页讲清方法链路：${compact}`;
    case 'formula':
      return `本页解释关键模块：${compact}`;
    case 'experiments':
      return `本页说明实验设置：${compact}`;
    case 'results':
      return `本页回到实验结论：${compact}`;
    case 'innovation':
      return `本页提炼真实差异：${compact}`;
    case 'limitations':
      return `本页保留边界讨论：${compact}`;
    case 'inspiration':
      return `本页转化为可复现实验：${compact}`;
    case 'summary':
      return `本页收束复现判断：${compact}`;
    default:
      return compact;
  }
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
      title: meta.visual === 'table' ? '实验/结果表格证据' : getFigureVisualTitle(slide.type, figure),
      caption: truncateText(figure.caption, 96),
      sourceLabel,
      figure,
      steps
    };
  }

  if (['method', 'formula', 'experiments', 'results'].includes(slide.type) && steps.length >= 4 && !hasForbiddenGeneric(steps.join(' '))) {
    return {
      kind: 'diagram',
      title: getDiagramTitle(slide.type),
      caption: '未找到可直接裁剪的原文图表，使用可编辑结构图表达原文中的具体流程。',
      sourceLabel,
      steps
    };
  }

  return {
    kind: 'none',
    title: '证据摘要',
    caption: slide.sourceRefs[0] ? truncateText(slide.sourceRefs[0].text, 96) : '原文未明确说明',
    sourceLabel,
    steps
  };
}

function buildVisualSteps(slide: PresentationSlide): string[] {
  const sourceText = getSlideEvidenceText(slide);
  const lower = sourceText.toLowerCase();
  if (slide.type === 'method' || slide.type === 'formula') {
    const concreteSteps = buildConcreteMethodSteps(sourceText);
    if (concreteSteps.length >= 4) {
      return concreteSteps;
    }
    if (/π0\.?7|pi0\.?7|VLA|VLM|vision[-\s]?language[-\s]?action\b/iu.test(sourceText)) {
      return compactVisualSteps(['language instruction', 'VLA policy', 'subgoal images / episode metadata', 'action output', 'diverse training data'], 5);
    }
    if (/\bPILOT|humanoid|loco[-\s]?manipulation|whole[-\s]?body\b/iu.test(sourceText)) {
      return compactVisualSteps(['LiDAR / exteroceptive input', 'PILOT controller', 'hybrid internal command', 'whole-body action', 'RL stability objective'], 5);
    }
  }
  if (slide.type === 'experiments' || slide.type === 'results') {
    const steps = [
      matchFirstTerm(sourceText, [
        { pattern: /\bPILOT\b/iu, label: 'PILOT' },
        { pattern: /π0\.?7|pi0\.?7/iu, label: 'π0.7' }
      ]) ?? (/\bbaseline|benchmark|comparison|对比\b/iu.test(lower) ? '本文方法' : undefined),
      matchFirstTerm(sourceText, [
        { pattern: /\bexisting baselines?\b/iu, label: 'existing baselines' },
        { pattern: /\bspecialist policies\b/iu, label: 'specialist policies' },
        { pattern: /\bimitation learning baselines?\b/iu, label: 'imitation baselines' }
      ]) ?? (/\bbaseline|benchmark|comparison|对比\b/iu.test(lower) ? 'Baselines' : undefined),
      matchFirstTerm(sourceText, [
        { pattern: /\bUnitree\s*G1\b/iu, label: 'Unitree G1' },
        { pattern: /\bsimulation\b/iu, label: 'simulation' },
        { pattern: /\breal[-\s]?world\b/iu, label: 'real-world' }
      ]) ?? (/\bsimulation|real[-\s]?world|Unitree|robot|仿真|真机\b/iu.test(lower) ? '仿真/真机任务' : undefined),
      matchFirstTerm(sourceText, [
        { pattern: /\bstability\b/iu, label: 'stability' },
        { pattern: /\bcommand tracking(?: precision)?\b/iu, label: 'command tracking' },
        { pattern: /\bterrain traversability\b/iu, label: 'terrain traversability' },
        { pattern: /\bsuccess rate\b/iu, label: 'success rate' }
      ]) ?? (/\bsuccess|tracking|stability|metric|rate|指标|成功率|稳定性\b/iu.test(lower) ? '核心指标' : undefined),
      /\bablation|generalization|robustness|消融|泛化|鲁棒\b/iu.test(lower) ? '消融/泛化验证' : undefined
    ];
    return compactVisualSteps(steps, 5);
  }
  return [];
}

function buildConcreteMethodSteps(sourceText: string): string[] {
  const steps = [
    matchFirstTerm(sourceText, [
      { pattern: /\bPILOT\b/iu, label: 'PILOT controller' },
      { pattern: /π0\.?7|pi0\.?7/iu, label: 'π0.7 model' },
      { pattern: /\bVLA\b|\bvision[-\s]?language[-\s]?action\b/iu, label: 'VLA policy' }
    ]),
    matchFirstTerm(sourceText, [
      { pattern: /\bLiDAR[-\s]?based elevation maps?\b/iu, label: 'LiDAR elevation map' },
      { pattern: /\bproprioception\b|\bproprioceptive states?\b/iu, label: 'proprioception' },
      { pattern: /\bRGB observations?\b|\bvisual observations?\b/iu, label: 'visual observation' },
      { pattern: /\blanguage (instructions?|goals?|commands?)\b/iu, label: 'language instruction' }
    ]),
    matchFirstTerm(sourceText, [
      { pattern: /\bhybrid internal command(?: representation)?\b/iu, label: 'hybrid internal command' },
      { pattern: /\bcontext conditioning\b/iu, label: 'context conditioning' },
      { pattern: /\bsubgoal images?\b/iu, label: 'subgoal images' },
      { pattern: /\bepisode metadata\b/iu, label: 'episode metadata' }
    ]),
    matchFirstTerm(sourceText, [
      { pattern: /\bwhole[-\s]?body actions?\b/iu, label: 'whole-body action' },
      { pattern: /\blow[-\s]?level robot actions?\b/iu, label: 'low-level action' },
      { pattern: /\bcontrol commands?\b/iu, label: 'control command' }
    ]),
    matchFirstTerm(sourceText, [
      { pattern: /\bL\s*=\s*L_/iu, label: 'training objective' },
      { pattern: /\breinforcement learning\b|\bRL\b/iu, label: 'RL training' },
      { pattern: /\bstability\b/iu, label: 'stability objective' }
    ])
  ];

  return compactVisualSteps(steps, 5);
}

function compactVisualSteps(items: Array<string | undefined>, limit: number): string[] {
  const result: string[] = [];
  items.forEach((item) => {
    const cleaned = cleanText(item);
    if (!cleaned || result.includes(cleaned)) {
      return;
    }
    result.push(cleaned);
  });
  return result.slice(0, limit);
}

function getSlideEvidenceText(slide: PresentationSlide): string {
  return [
    slide.title,
    slide.section,
    ...slide.bullets,
    ...slide.sourceRefs.map((ref) => `${ref.section} ${ref.text}`),
    ...slide.figures.map((figure) => figure.caption)
  ]
    .filter(Boolean)
    .join(' ');
}

function matchFirstTerm(sourceText: string, entries: Array<{ pattern: RegExp; label: string }>): string | undefined {
  return entries.find((entry) => entry.pattern.test(sourceText))?.label;
}

function extractFormulaBullet(sourceText: string): string {
  const match = sourceText.match(/L\s*=\s*[^.。;；\n]+/iu)?.[0];
  if (!match) {
    return '公式解释训练目标项';
  }
  return `核心公式 ${truncateText(match, 24)}`;
}

function getFigureVisualTitle(type: PresentationSlideType, figure: PresentationFigureCandidate): string {
  if (type === 'method' || type === 'formula') {
    return /architecture|overview|framework|method|controller|policy/i.test(figure.caption)
      ? '原文方法图证据'
      : '方法相关图表证据';
  }
  if (type === 'experiments' || type === 'results') {
    return /table/i.test(figure.caption) ? '实验结果表证据' : '实验结果图证据';
  }
  return '原文图表证据';
}

function getDiagramTitle(type: PresentationSlideType): string {
  if (type === 'method' || type === 'formula') return '可编辑方法流程图';
  if (type === 'experiments' || type === 'results') return '实验对比逻辑图';
  return '可编辑证据结构图';
}

function hasForbiddenGeneric(text: string): boolean {
  return FORBIDDEN_GENERIC_LABELS.some((label) => text.includes(label));
}

function hasMethodEvidence(slide: PptxSlidePlan): boolean {
  const evidence = [
    slide.mainClaim,
    ...slide.bullets,
    slide.visual.title,
    slide.visual.caption,
    ...slide.visual.steps
  ].join(' ');
  return /PILOT|RL|VLA|VLM|Unitree|感知|控制|策略|模型|动作|训练|controller|policy|model|action|objective/i.test(evidence);
}

function countExperimentEvidenceCategories(slide: PptxSlidePlan): number {
  const evidence = [
    slide.mainClaim,
    ...slide.bullets,
    slide.visual.title,
    slide.visual.caption,
    ...slide.visual.steps,
    slide.sourceFooter
  ].join(' ');
  let count = 0;
  if (/baseline|benchmark|comparison|对比|本文方法|Baselines/i.test(evidence)) count += 1;
  if (/metric|success|tracking|stability|rate|指标|成功率|稳定性/i.test(evidence)) count += 1;
  if (/result|performance|ablation|generalization|robustness|结果|性能|消融|泛化|鲁棒/i.test(evidence)) count += 1;
  return count;
}

function hasChineseText(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function summarizeRefAsChinese(type: PresentationSlideType, text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\bPILOT\b/iu.test(text)) {
    if (type === 'background') return 'PILOT 面向感知移动操作问题';
    if (type === 'method' || type === 'formula') return 'PILOT 串起感知输入和控制输出';
    if (type === 'innovation') return 'PILOT 差异点是感知闭环控制';
    if (type === 'summary') return 'PILOT 主线是感知到动作闭环';
    return undefined;
  }
  if (/\bUnitree\s*G1\b/iu.test(text)) {
    if (type === 'experiments') return 'Unitree G1 用于真实平台设置';
    if (type === 'results') return 'Unitree G1 支撑真机结果验证';
    if (type === 'summary') return '真机结果来自 Unitree G1';
    return undefined;
  }
  if (/π0\.?7|pi0\.?7\b/iu.test(text)) {
    if (type === 'background') return 'π0.7 关注未见环境指令执行';
    if (type === 'method' || type === 'formula') return 'π0.7 依靠上下文调节策略';
    if (type === 'summary') return 'π0.7 主线是上下文条件控制';
    return undefined;
  }
  if (/\bVLA|VLM|vision[-\s]?language[-\s]?action\b/iu.test(text)) {
    if (type === 'background') return 'VLA/VLM 暴露语言到动作泛化问题';
    if (type === 'method' || type === 'formula') return 'VLA/VLM 连接语言指令与动作';
    if (type === 'innovation') return '贡献落在语言到动作接口';
    return undefined;
  }
  if (/\bsubgoal images?|episode metadata\b/iu.test(text)) {
    if (type === 'background') return 'subgoal images 和 episode metadata 指出长程任务难点';
    if (type === 'method' || type === 'formula') return '子目标图像和元数据约束策略';
    if (type === 'summary') return '上下文信息帮助策略分阶段执行';
    return undefined;
  }
  if (/\blanguage (instructions?|commands?)\b/iu.test(text)) {
    if (type === 'background') return 'language instruction 要在未见环境中执行';
    if (type === 'method') return 'language instruction 作为策略输入';
    return undefined;
  }
  if (/\blong[-\s]?horizon tasks?\b/iu.test(text)) {
    if (type === 'background') return 'long-horizon tasks 检验组合执行能力';
    if (type === 'summary') return '长程任务是主要验证对象';
    return undefined;
  }
  if (/\bdemonstration|autonomous data|multimodal web data\b/iu.test(text)) {
    if (type === 'method' || type === 'experiments') return '多源数据支撑策略训练';
    return undefined;
  }
  if (/\bterrain|unstructured|scene|environment\b/u.test(lower)) {
    if (type === 'background') return '非结构化环境暴露控制瓶颈';
    if (type === 'experiments') return '非结构化场景用于任务设置';
    if (type === 'limitations') return '复杂场景仍是部署边界';
    return undefined;
  }
  if (/\bcontrol|controller|policy|action\b/u.test(lower)) {
    if (type === 'method' || type === 'formula') return '控制策略同时处理运动和执行';
    if (type === 'inspiration') return '控制闭环可作为复现实验线索';
    return undefined;
  }
  if (/\bexperiment|evaluation|baseline|simulation|real\b/u.test(lower)) {
    if (type === 'experiments') return '实验设置包含 baseline 与平台';
    if (type === 'results') return '结果页需要回到 baseline 对比';
    return undefined;
  }
  if (/\bmethod|framework|architecture|model\b/u.test(lower)) {
    if (type === 'method') return '方法页解释模型和控制协同';
    return undefined;
  }
  if (/\bRL|reinforcement learning|training\b/iu.test(text)) {
    if (type === 'formula' || type === 'method') return 'RL 训练服务低层控制目标';
    if (type === 'experiments') return '训练设置需要和评估指标对应';
    return undefined;
  }
  if (/\blimitation|future|failure\b/u.test(lower)) {
    return '后续仍需验证部署边界和失败场景';
  }

  return undefined;
}

function compactUnique(items: Array<string | undefined>, limit: number): string[] {
  const result: string[] = [];
  const keys = new Set<string>();
  const semanticKeys = new Set<string>();
  items.forEach((item) => {
    const compact = compactChineseBullet(item);
    const key = compact ? normalizeBulletForCompare(compact) : '';
    const semanticKey = compact ? getSemanticBulletKey(compact) : '';
    if (!compact || !key || keys.has(key) || (semanticKey && semanticKeys.has(semanticKey))) {
      return;
    }
    keys.add(key);
    if (semanticKey) {
      semanticKeys.add(semanticKey);
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
  if (asciiRatio(normalized) > 0.58 && !/[=+*/^_{}]/u.test(normalized)) {
    return summarizeRefAsChinese('summary', normalized) ?? summarizeEnglishLikeBullet(normalized);
  }
  return truncateText(normalized, MAX_BULLET_LENGTH);
}

function summarizeEnglishLikeBullet(text: string): string | undefined {
  if (/π0\.?7|pi0\.?7\b/iu.test(text)) return 'π0.7 使用 context conditioning 调节策略';
  if (/\blanguage (instructions?|commands?)\b/iu.test(text)) return '语言指令作为策略输入';
  if (/\bsubgoal images?\b/iu.test(text)) return '子目标图像提供阶段目标';
  if (/\bepisode metadata\b/iu.test(text)) return '回合元数据描述任务上下文';
  if (/\blong[-\s]?horizon tasks?\b/iu.test(text)) return '长程任务检验组合执行';
  if (/\bLiDAR[-\s]?based elevation maps?\b/iu.test(text)) return 'LiDAR elevation map 提供外部地形感知';
  if (/\bhybrid internal command(?: representation)?\b/iu.test(text)) return '混合内部命令连接任务意图';
  if (/\bwhole[-\s]?body actions?\b/iu.test(text)) return '全身动作作为控制输出';
  if (/\bcommand tracking(?: precision)?\b/iu.test(text)) return '命令跟踪衡量控制精度';
  if (/\bterrain traversability\b/iu.test(text)) return '地形通过性衡量复杂场景结果';
  if (/\bRL|reinforcement learning|training\b/iu.test(text)) return '强化学习服务低层控制目标';
  if (/\bbaseline|benchmark|comparison\b/iu.test(text)) return '基线对比支撑实验结论';
  if (/\bsuccess|tracking|stability|metric|rate\b/iu.test(text)) return '指标用于验证控制效果';
  if (/\bUnitree\s*G1\b/iu.test(text)) return 'Unitree G1 支撑真机结果验证';
  if (/\bPILOT\b/iu.test(text)) return 'PILOT 主线是感知到动作闭环';
  return undefined;
}

function buildSourceFooter(slide: PresentationSlide, figure?: PresentationFigureCandidate): string {
  const refs = getScopedSourceRefs(slide)
    .slice(0, 2)
    .map((ref) => `p. ${ref.pageNumber} · ${cleanText(ref.section) ?? 'PDF'}`);
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
