import type { ExtractedPdfBlock } from './pdfTextStructure';
import type { PaperRecord } from './papers';

export type PresentationSlideType =
  | 'cover'
  | 'info'
  | 'background'
  | 'relatedWork'
  | 'method'
  | 'formula'
  | 'experiments'
  | 'results'
  | 'innovation'
  | 'limitations'
  | 'inspiration'
  | 'summary';

export type PresentationFigureKind = 'method' | 'setup' | 'result' | 'case' | 'formula' | 'unknown';

export interface PresentationSourcePaper {
  paperId: string;
  title: string;
  pdfPath: string;
  pagesUsed: number[];
  figuresUsed: string[];
}

export interface PresentationSourceRef {
  pageNumber: number;
  section: string;
  text: string;
}

export interface PresentationFigureCandidate {
  imageId: string;
  pageNumber: number;
  caption: string;
  source: 'pdf-caption';
  suggestedSlide: PresentationSlideType;
  figureKind?: PresentationFigureKind;
  selected?: boolean;
  suggestedReason?: string;
  cropBox?: PresentationFigureCropBox;
  cropStatus?: 'caption-only' | 'crop-ready' | 'image-ready';
  imageDataUrl?: string;
  imageMimeType?: 'image/png' | 'image/jpeg';
}

export interface PresentationFigureCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PresentationSlide {
  id: string;
  type: PresentationSlideType;
  title: string;
  subtitle?: string;
  section?: string;
  confidence?: 'local' | 'ai-enhanced';
  bullets: string[];
  figures: PresentationFigureCandidate[];
  sourceRefs: PresentationSourceRef[];
  speakerNotes: string;
}

export interface DeepMethodStage {
  stage_name: string;
  input: string;
  process: string;
  output: string;
  purpose: string;
  connects_to_next: string;
  source: string;
  sourceRefs?: PresentationSourceRef[];
}

export interface DeepMethodKeyDesign {
  name: string;
  problem_it_solves: string;
  how_it_works: string;
  evidence: string;
  source: string;
}

export type DeepMethodPaperType = 'algorithm' | 'system' | 'application' | 'experiment' | 'review' | 'other';

export interface DeepMethodTrainingImplementation {
  what_is_trained_or_built: string;
  data_or_inputs: string;
  objective_or_rules: string;
  important_details: string;
  source: string;
  sourceRefs?: PresentationSourceRef[];
}

export interface DeepMethodEvaluationLogic {
  tasks_or_datasets: string;
  baselines: string;
  metrics: string;
  main_results: string;
  what_the_results_prove: string;
  source: string;
  sourceRefs?: PresentationSourceRef[];
}

export interface DeepMethodLimitations {
  author_stated: string;
  inferred: string;
  source: string;
  sourceRefs?: PresentationSourceRef[];
}

export interface DeepMethodMap {
  paper_type: DeepMethodPaperType;
  core_problem: string;
  why_difficult: string[];
  prior_work_limitations: string[];
  main_idea: string;
  method_stages: DeepMethodStage[];
  key_designs: DeepMethodKeyDesign[];
  training_or_implementation: DeepMethodTrainingImplementation;
  evaluation_logic: DeepMethodEvaluationLogic;
  limitations: DeepMethodLimitations;
}

export interface PresentationReviewReport {
  passed: boolean;
  can_explain_method_from_ppt_only: boolean;
  can_identify_core_problem: boolean;
  can_identify_method_stages: boolean;
  can_identify_stage_inputs: boolean;
  can_identify_stage_outputs: boolean;
  can_identify_stage_connections: boolean;
  can_identify_training_or_implementation: boolean;
  can_identify_evaluation_logic: boolean;
  repeated_keyword_problem: boolean;
  generic_template_problem: boolean;
  slide_type_mismatch: boolean;
  figure_mismatch: boolean;
  failed_slides: Array<{ index: number; type: PresentationSlideType; reason: string }>;
  issues: string[];
  auto_revisions: number;
  remaining_risks: string[];
}

export interface PresentationDraft {
  id: string;
  title: string;
  subtitle: string;
  sourcePapers: PresentationSourcePaper[];
  figures: PresentationFigureCandidate[];
  slides: PresentationSlide[];
  methodMap?: DeepMethodMap;
  reviewReport?: PresentationReviewReport;
  createdAt: string;
}

export interface BuildPresentationDraftInput {
  papers: PaperRecord[];
  blocks: ExtractedPdfBlock[];
  targetSlideCount?: number;
  speakerName?: string;
}

export interface PresentationAiEnhancementPrompt {
  systemPrompt: string;
  userPrompt: string;
}

interface SectionBucket {
  name: string;
  refs: PresentationSourceRef[];
}

interface SectionBuckets {
  abstract: SectionBucket;
  introduction: SectionBucket;
  relatedWork: SectionBucket;
  method: SectionBucket;
  formula: SectionBucket;
  experiments: SectionBucket;
  results: SectionBucket;
  conclusion: SectionBucket;
  limitations: SectionBucket;
}

const REFERENCE_SECTION_PATTERN = /^(references?|bibliography|参考文献)\b/iu;
const ABSTRACT_SECTION_PATTERN = /abstract|摘要/iu;
const RELATED_WORK_SECTION_PATTERN = /related\s+work|prior\s+work|literature|相关工作|现有工作/iu;
const INTRO_SECTION_PATTERN = /intro|background|motivation|problem|背景|动机|引言/iu;
const METHOD_SECTION_PATTERN = /method|approach|model|framework|algorithm|overview|architecture|training|implementation|方法|模型|算法|框架|结构|训练|实现/iu;
const FORMULA_SECTION_PATTERN = /formula|equation|objective|loss|公式|损失|目标函数/iu;
const EXPERIMENT_SECTION_PATTERN = /experiment|evaluation|dataset|benchmark|setting|ablation|实验|评估|数据集|基准|消融/iu;
const RESULT_SECTION_PATTERN = /result|quantitative|comparison|performance|结果|对比|性能/iu;
const CONCLUSION_SECTION_PATTERN = /conclusion|discussion|future|总结|结论|讨论|未来/iu;
const LIMITATION_SECTION_PATTERN = /limitation|failure|weakness|局限|不足|失败/iu;
const CAPTION_PATTERN = /^(fig\.?|figure|table|tab\.?)\s*\d+/iu;

export function buildPresentationDraft(input: BuildPresentationDraftInput): PresentationDraft {
  return buildLocalPresentationDraft(input);
}

export function buildDeepMethodMap(input: BuildPresentationDraftInput): DeepMethodMap {
  const usableBlocks = input.blocks.filter((block) => isUsablePresentationBlock(block));
  const buckets = bucketSections(usableBlocks);
  const abstractIntroRefs = pickRefs([buckets.abstract, buckets.introduction], 4);
  const methodRefs = pickRefs([buckets.method, buckets.formula, buckets.abstract], 8);
  const experimentRefs = pickRefs([buckets.experiments, buckets.results], 8);
  const conclusionRefs = pickRefs([buckets.conclusion, buckets.limitations], 4);
  const relatedWorkRefs = pickRefs([buckets.relatedWork], 4);
  const methodText = methodRefs.map((ref) => ref.text).join(' ');
  const problemText = abstractIntroRefs.map((ref) => ref.text).join(' ');
  const experimentText = experimentRefs.map((ref) => ref.text).join(' ');
  const conclusionText = conclusionRefs.map((ref) => ref.text).join(' ');
  const methodTerms = extractEvidenceTerms(methodText);
  const problemTerms = extractEvidenceTerms(problemText);
  const experimentTerms = extractEvidenceTerms(experimentText);
  const conclusionTerms = extractEvidenceTerms(conclusionText);

  const primaryMethod = methodTerms.methods[0] ?? problemTerms.methods[0] ?? getPaperTitle(input.papers[0]);
  const coreProblem = firstSpecificSentence(abstractIntroRefs, [
    /challenge|difficult|lack|insufficient|struggle|unstructured|dynamic clutter|problem/iu,
    /challenge|difficult|lack|insufficient|unstructured|problem|瓶颈|困难|不足/iu,
    /propose|present|introduce|address/iu
  ]);
  const mainIdea = firstSpecificSentence(methodRefs, [/propose|present|introduce|combine|incorporate|use|framework|controller|model/iu]);
  const stages = buildMethodStagesFromEvidence(primaryMethod, methodRefs, methodTerms, experimentTerms);

  return {
    paper_type: classifyPaperType(methodTerms, experimentTerms, `${problemText} ${methodText} ${experimentText}`),
    core_problem:
      coreProblem ??
      buildFallbackSentence(
        '核心问题',
        compactTextList([...problemTerms.platforms, ...problemTerms.tasks, ...problemTerms.observations], 3),
        problemText
      ),
    why_difficult: compactTextList(
      [
        ...buildDifficultyStatements(abstractIntroRefs),
        ...problemTerms.observations.map((term) => `${term} 让状态感知和决策更难`),
        ...problemTerms.tasks.map((term) => `${term} 需要跨阶段闭环执行`)
      ],
      4
    ),
    prior_work_limitations: buildPriorWorkLimitations([...abstractIntroRefs, ...relatedWorkRefs], problemTerms),
    main_idea:
      mainIdea ??
      buildFallbackSentence('主思路', compactTextList([...methodTerms.methods, ...methodTerms.observations, ...methodTerms.outputs], 4), methodText),
    method_stages: stages,
    key_designs: buildKeyDesigns(methodRefs, methodTerms),
    training_or_implementation: buildTrainingImplementation(primaryMethod, methodRefs, experimentRefs, methodTerms, experimentTerms),
    evaluation_logic: buildEvaluationLogic(experimentRefs, conclusionRefs, experimentTerms),
    limitations: buildLimitations(conclusionRefs, experimentRefs, conclusionTerms)
  };
}

export function buildLocalPresentationDraft(input: BuildPresentationDraftInput): PresentationDraft {
  const paper = input.papers[0];
  const title = getPaperTitle(paper);
  const usableBlocks = input.blocks.filter((block) => isUsablePresentationBlock(block));
  const figures = extractFigureCandidates(usableBlocks);
  const buckets = bucketSections(usableBlocks);
  const methodMap = buildDeepMethodMap(input);

  const slides = [
    buildCoverSlide(title, paper, input.speakerName),
    buildInfoSlide(paper, buckets.abstract),
    buildContentSlide({
      id: 'slide-background',
      type: 'background',
      title: '研究背景',
      section: 'Introduction',
      refs: pickRefs([buckets.introduction, buckets.abstract], 4),
      fallback: '原文未明确说明研究背景或问题。',
      speakerNote: '用一到两句话说明这篇论文想解决什么问题，以及为什么这个问题重要。'
    }),
    buildContentSlide({
      id: 'slide-related-work',
      type: 'relatedWork',
      title: 'Related Work / 现有不足',
      section: 'Related Work',
      refs: pickRefs([buckets.relatedWork, buckets.introduction], 4),
      fallback: '原文未明确说明相关工作或现有方法不足。',
      speakerNote: '强调已有方法的边界，不把论文贡献夸大成领域终局方案。'
    }),
    buildContentSlide({
      id: 'slide-method',
      type: 'method',
      title: '方法框架',
      section: 'Method',
      refs: pickRefs([buckets.method, buckets.abstract], 4),
      figures: pickFigures(figures, 'method', 2),
      fallback: '原文未明确说明方法框架。',
      speakerNote: '优先结合论文方法图解释输入、核心模块、输出和关键设计动机。'
    }),
    buildContentSlide({
      id: 'slide-formula',
      type: 'formula',
      title: '关键模块或公式',
      section: 'Method',
      refs: pickRefs([buckets.formula, buckets.method], 3),
      figures: pickFiguresForTypes(figures, ['formula', 'method'], 1),
      fallback: '原文未明确说明关键公式，汇报时可只解释核心模块。',
      speakerNote: '只讲对方法理解必要的公式或模块，不堆满推导。'
    }),
    buildContentSlide({
      id: 'slide-experiments',
      type: 'experiments',
      title: '实验设置',
      section: 'Experiments',
      refs: pickRefs([buckets.experiments, buckets.results], 3),
      figures: pickFiguresForTypes(figures, ['experiments', 'results'], 1),
      fallback: '原文未明确说明实验设置。',
      speakerNote: '交代数据集、任务、对比方法和评价指标。'
    }),
    buildContentSlide({
      id: 'slide-results',
      type: 'results',
      title: '主要实验结果',
      section: 'Results',
      refs: pickRefs([buckets.results, buckets.experiments], 4),
      figures: pickFiguresForTypes(figures, ['results', 'experiments'], 2),
      fallback: '原文未明确说明实验结果。',
      speakerNote: '说明主要结果和指标变化，不夸大论文结论。'
    }),
    buildContentSlide({
      id: 'slide-innovation',
      type: 'innovation',
      title: '创新点总结',
      section: 'Contribution',
      refs: pickRefs([buckets.abstract, buckets.method, buckets.conclusion], 4),
      fallback: '原文未明确说明创新点。',
      speakerNote: '说明相比前人工作真正不同的地方，以及为什么该设计可能有效。'
    }),
    buildContentSlide({
      id: 'slide-limitations',
      type: 'limitations',
      title: '局限性与讨论',
      section: 'Limitations',
      refs: pickRefs([buckets.limitations, buckets.conclusion, buckets.experiments], 4),
      fallback: '原文未明确说明局限性，可在汇报时谨慎补充个人判断。',
      speakerNote: '区分作者明确说明的局限和基于原文内容归纳的局限。'
    }),
    buildContentSlide({
      id: 'slide-inspiration',
      type: 'inspiration',
      title: '对我课题的启发',
      section: 'Research Inspiration',
      refs: pickRefs([buckets.method, buckets.experiments, buckets.conclusion], 4),
      fallback: '可结合自己的 RL、PINN、安全约束或路径规划课题补充启发。',
      speakerNote: '围绕可复用模块、可迁移实验设计和可作为 baseline 的方法。'
    }),
    buildContentSlide({
      id: 'slide-summary',
      type: 'summary',
      title: '总结',
      section: 'Summary',
      refs: pickRefs([buckets.abstract, buckets.conclusion], 3),
      fallback: '一句话总结这篇论文是否值得复现，以及下一步怎么做。',
      speakerNote: '最后明确是否值得深入复现，以及最值得借鉴的一点。'
    })
  ];

  applyMethodMapToSlides(slides, methodMap);
  ensureContentSlideEvidenceDensity(slides);

  const targetCount = Math.max(4, Math.min(slides.length, input.targetSlideCount ?? slides.length));
  const selectedSlides = selectSlidesForTargetCount(slides, targetCount);
  const usedPages = getUsedPages(selectedSlides);
  const usedFigureIds = selectedSlides.flatMap((slide) => slide.figures.map((figure) => figure.imageId));

  return {
    id: `presentation-${paper?.id ?? 'current'}-${Date.now()}`,
    title,
    subtitle: '研究生组会完整学术风格 PPT 草稿',
    sourcePapers: input.papers.map((item) => ({
      paperId: item.id,
      title: getPaperTitle(item),
      pdfPath: item.pdfPath,
      pagesUsed: usedPages,
      figuresUsed: usedFigureIds
    })),
    figures,
    slides: selectedSlides,
    methodMap,
    createdAt: new Date().toISOString()
  };
}

export function serializePresentationMarkdown(draft: PresentationDraft): string {
  const lines: string[] = [
    `# ${draft.title}`,
    '',
    `> ${draft.subtitle}`,
    '',
    `生成时间：${new Date(draft.createdAt).toLocaleString()}`,
    ''
  ];

  draft.slides.forEach((slide, index) => {
    lines.push(`## ${index + 1}. ${slide.title}`);
    if (slide.subtitle) {
      lines.push('', slide.subtitle);
    }
    if (slide.bullets.length > 0) {
      lines.push('', ...slide.bullets.map((bullet) => `- ${bullet}`));
    }
    if (slide.figures.length > 0) {
      lines.push('', '图表候选：');
      slide.figures.forEach((figure) => {
        lines.push(`- ${figure.caption}（来源：p. ${figure.pageNumber}；用途：${figure.suggestedReason ?? figure.suggestedSlide}）`);
      });
    }
    if (slide.sourceRefs.length > 0) {
      lines.push('', '来源：');
      slide.sourceRefs.forEach((ref) => {
        lines.push(`- p. ${ref.pageNumber} · ${ref.section}：${ref.text}`);
      });
    }
    if (slide.speakerNotes) {
      lines.push('', `备注：${slide.speakerNotes}`);
    }
    lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
}

export function buildPresentationAiEnhancementPrompt(draft: PresentationDraft): PresentationAiEnhancementPrompt {
  const compactSlides = draft.slides
    .filter((slide) => slide.type !== 'cover')
    .map((slide) => ({
      id: slide.id,
      type: slide.type,
      title: slide.title,
      bullets: slide.bullets.slice(0, 5),
      sources: slide.sourceRefs.slice(0, 4).map((ref) => ({
        pageNumber: ref.pageNumber,
        section: ref.section,
        text: ref.text
      })),
      figures: slide.figures.slice(0, 2).map((figure) => ({
        imageId: figure.imageId,
        pageNumber: figure.pageNumber,
        caption: figure.caption,
        suggestedSlide: figure.suggestedSlide
      }))
    }));

  return {
    systemPrompt: [
      'You are a rigorous graduate seminar slide editor.',
      'Rewrite slide bullets to be specific, source-grounded, concise, and suitable for an academic group meeting.',
      'Do not invent facts. Preserve citation/page traceability. Output strict JSON only.'
    ].join('\n'),
    userPrompt: [
      'Rewrite the following PPT outline.',
      'Return JSON with this exact shape: {"slides":[{"id":"slide-id","type":"method","title":"...","bullets":["..."],"speakerNotes":"..."}]}',
      'Rules:',
      '- Match every slide by id.',
      '- Keep each slide to 3-5 bullets.',
      '- Each bullet should be concrete and mention paper-specific objects, modules, tasks, metrics, baselines, platforms, or results when the sources support it.',
      '- At least two bullets on each non-cover slide must include exact source-backed details such as robot platform, input observation, output action, model module, training objective, baseline, metric, dataset, task, or figure caption.',
      '- For robotics/RL/VLA/PINN papers, prefer details about robot platform, input observation, output action, training data/objective, baseline, metric, real robot validation, and limitation.',
      '- Do not use generic bullets such as “框架串联感知、策略、执行”, “任务指令转成机器人策略”, “方法强调模型、控制和执行协同”, “增强泛化能力”, or “面向复杂场景”.',
      '- If the source does not support a method diagram, say the missing detail explicitly instead of writing a generic placeholder.',
      '- Do not output Markdown fences or explanations.',
      '- Do not remove source pages or figure ids; the app will keep them separately.',
      '',
      JSON.stringify(
        {
          title: draft.title,
          sourcePapers: draft.sourcePapers,
          methodMap: draft.methodMap,
          slides: compactSlides
        },
        null,
        2
      )
    ].join('\n')
  };
}

export function applyAiEnhancedPresentationDraft(draft: PresentationDraft, aiText: string): PresentationDraft {
  const parsed = parseAiEnhancementResponse(aiText);
  if (!parsed || !Array.isArray(parsed.slides)) {
    throw new Error('AI did not return a valid slides array.');
  }

  const patchById = new Map<string, AiEnhancedSlidePatch>();
  parsed.slides.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const patch = item as AiEnhancedSlidePatch;
    if (typeof patch.id === 'string' && patch.id.trim()) {
      patchById.set(patch.id, patch);
    }
  });

  return {
    ...draft,
    subtitle: `${draft.subtitle} · AI enhanced`,
    slides: draft.slides.map((slide) => {
      const patch = patchById.get(slide.id);
      if (!patch) {
        return slide;
      }

      const bullets = sanitizeAiBullets(patch.bullets);
      return {
        ...slide,
        title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : slide.title,
        subtitle: typeof patch.subtitle === 'string' && patch.subtitle.trim() ? patch.subtitle.trim() : slide.subtitle,
        bullets: bullets.length > 0 ? bullets : slide.bullets,
        speakerNotes:
          typeof patch.speakerNotes === 'string' && patch.speakerNotes.trim()
            ? patch.speakerNotes.trim()
            : slide.speakerNotes,
        confidence: 'ai-enhanced'
      };
    })
  };
}

interface AiEnhancedSlidePatch {
  id?: string;
  type?: PresentationSlideType;
  title?: string;
  subtitle?: string;
  bullets?: unknown;
  speakerNotes?: string;
}

function parseAiEnhancementResponse(aiText: string): { slides?: unknown[] } | null {
  const trimmed = aiText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  const jsonStart = candidate.indexOf('{');
  const jsonEnd = candidate.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as { slides?: unknown[] };
  } catch {
    return null;
  }
}

function sanitizeAiBullets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? normalizeInlineText(item, 96) : ''))
    .filter(Boolean)
    .slice(0, 5);
}

export function extractFigureCandidates(blocks: ExtractedPdfBlock[]): PresentationFigureCandidate[] {
  let figureIndex = 0;

  return blocks
    .filter((block) => block.type === 'caption' || CAPTION_PATTERN.test(block.original.trim()))
    .filter((block) => !isReferenceSection(block.section))
    .map((block) => {
      figureIndex += 1;
      const figureKind = classifyFigureKind(block.original);
      const suggestedSlide = suggestFigureSlide(block.original, figureKind);
      const cropBox = inferFigureCropBoxFromCaptionBlock(block);
      return {
        imageId: `fig-${block.page}-${figureIndex}`,
        pageNumber: block.page,
        caption: normalizeInlineText(block.original, 240),
        source: 'pdf-caption' as const,
        suggestedSlide,
        figureKind,
        selected: true,
        suggestedReason: getFigureReason(suggestedSlide, figureKind),
        cropBox,
        cropStatus: cropBox ? 'crop-ready' : 'caption-only'
      };
    });
}

export function inferFigureCropBoxFromCaptionBlock(block: ExtractedPdfBlock): PresentationFigureCropBox | undefined {
  const bounds = block.bounds;
  if (!bounds || !bounds.pageWidth || !bounds.pageHeight) {
    return undefined;
  }

  const pageWidth = bounds.pageWidth;
  const pageHeight = bounds.pageHeight;
  const horizontalMargin = Math.max(14, pageWidth * 0.025);
  const figurePadding = Math.max(8, pageHeight * 0.012);
  const captionTop = clamp(bounds.y, 0, pageHeight);
  const targetHeight = clamp(pageHeight * 0.32, pageHeight * 0.18, pageHeight * 0.48);
  const captionLooksAboveVisual = /^table\b/iu.test(block.original.trim()) || captionTop < pageHeight * 0.22;
  const cropY = captionLooksAboveVisual
    ? clamp(captionTop + bounds.height + figurePadding, pageHeight * 0.04, pageHeight * 0.82)
    : clamp(captionTop - targetHeight - figurePadding, pageHeight * 0.04, Math.max(pageHeight * 0.04, captionTop - 30));
  const cropHeight = captionLooksAboveVisual
    ? clamp(targetHeight, pageHeight * 0.12, pageHeight - cropY - pageHeight * 0.04)
    : clamp(captionTop - cropY - figurePadding, pageHeight * 0.12, pageHeight * 0.52);
  const wideCaption = bounds.width >= pageWidth * 0.42;
  const cropWidth = wideCaption
    ? clamp(bounds.width + horizontalMargin * 2, pageWidth * 0.48, pageWidth * 0.92)
    : clamp(Math.max(bounds.width + horizontalMargin * 2, pageWidth * 0.34), pageWidth * 0.28, pageWidth * 0.5);
  const cropX = clamp(bounds.x - horizontalMargin, pageWidth * 0.03, Math.max(pageWidth * 0.03, pageWidth - cropWidth));

  return {
    x: roundNumber(cropX),
    y: roundNumber(cropY),
    width: roundNumber(clamp(cropWidth, 1, pageWidth - cropX)),
    height: roundNumber(clamp(cropHeight, 1, pageHeight - cropY)),
    pageWidth: roundNumber(pageWidth),
    pageHeight: roundNumber(pageHeight)
  };
}

function buildCoverSlide(title: string, paper: PaperRecord | undefined, speakerName?: string): PresentationSlide {
  const subtitleParts = [paper?.journal, paper?.year, speakerName ? `汇报人：${speakerName}` : '组会 / 文献汇报'].filter(
    Boolean
  );

  return {
    id: 'slide-cover',
    type: 'cover',
    title,
    subtitle: subtitleParts.join(' · '),
    section: 'Cover',
    confidence: 'local',
    bullets: [
      paper?.pdfName ? `原文 PDF：${paper.pdfName}` : '原文 PDF：当前打开论文',
      paper?.authors ? `作者：${normalizeInlineText(paper.authors, 80)}` : '作者：原文或论文库未明确说明',
      '目标：用 10 分钟讲清研究问题、方法框架、实验结论和可借鉴点'
    ],
    figures: [],
    sourceRefs: [],
    speakerNotes: '封面页保持简洁，说明论文来源、汇报背景和本次汇报目标。'
  };
}

function buildInfoSlide(paper: PaperRecord | undefined, abstractBucket: SectionBucket): PresentationSlide {
  const bullets = [
    paper?.englishTitle ? `英文标题：${paper.englishTitle}` : '',
    paper?.authors ? `作者：${paper.authors}` : '',
    paper?.journal || paper?.year ? `来源：${[paper?.journal, paper?.year].filter(Boolean).join(' · ')}` : ''
  ].filter(Boolean);

  return {
    id: 'slide-info',
    type: 'info',
    title: '论文基本信息',
    section: 'Paper Info',
    confidence: 'local',
    bullets: limitBullets([...bullets, ...refsToBullets(abstractBucket.refs.slice(0, 2))], 5),
    figures: [],
    sourceRefs: abstractBucket.refs.slice(0, 2),
    speakerNotes: '简要交代论文主题、作者和发表信息。'
  };
}

function buildContentSlide(options: {
  id: string;
  type: PresentationSlideType;
  title: string;
  section: string;
  refs: PresentationSourceRef[];
  figures?: PresentationFigureCandidate[];
  fallback: string;
  speakerNote: string;
}): PresentationSlide {
  const bullets = buildEvidenceAwareBullets(options.type, options.refs, {
    allowFormulaText: options.type === 'formula'
  });

  return {
    id: options.id,
    type: options.type,
    title: options.title,
    section: options.section,
    confidence: 'local',
    bullets: bullets.length > 0 ? limitBullets(bullets, 5) : [options.fallback],
    figures: options.figures ?? [],
    sourceRefs: options.refs,
    speakerNotes: options.speakerNote
  };
}

function applyMethodMapToSlides(slides: PresentationSlide[], methodMap: DeepMethodMap): void {
  const background = slides.find((slide) => slide.type === 'background');
  if (background) {
    background.bullets = limitBullets(
      compactPresentationBullets([methodMap.core_problem, ...methodMap.why_difficult], 4),
      5
    );
  }

  const method = slides.find((slide) => slide.type === 'method');
  if (method && methodMap.method_stages.length > 0) {
    method.bullets = limitBullets(
      methodMap.method_stages.map((stage) =>
        normalizeInlineText(`${stage.stage_name}：${stage.input} → ${stage.process} → ${stage.output}`, 120)
      ),
      5
    );
    method.sourceRefs = compactRefs(methodMap.method_stages.flatMap((stage) => stage.sourceRefs ?? []), 4) || method.sourceRefs;
  }

  const formula = slides.find((slide) => slide.type === 'formula');
  if (formula && methodMap.method_stages.length > 1) {
    const formulaBullets = formula.bullets.filter((bullet) => /[=+\-*/^_{}]/u.test(bullet));
    formula.bullets = limitBullets(
      [
        ...formulaBullets,
        ...methodMap.method_stages.slice(0, 3).map((stage) =>
          normalizeInlineText(`${stage.stage_name} 解决：${stage.purpose}；连接：${stage.connects_to_next}`, 120)
        )
      ],
      5
    );
  }

  const experiments = slides.find((slide) => slide.type === 'experiments');
  if (experiments && methodMap.evaluation_logic) {
    experiments.bullets = limitBullets(compactPresentationBullets([formatEvaluationLogic(methodMap.evaluation_logic), ...experiments.bullets], 5), 5);
    experiments.sourceRefs = compactRefs([...(methodMap.evaluation_logic.sourceRefs ?? []), ...experiments.sourceRefs], 4);
  }

  const results = slides.find((slide) => slide.type === 'results');
  if (results && methodMap.evaluation_logic) {
    results.bullets = limitBullets(
      compactPresentationBullets(
        [methodMap.evaluation_logic.main_results, methodMap.evaluation_logic.what_the_results_prove, ...results.bullets],
        5
      ),
      5
    );
    results.sourceRefs = compactRefs([...(methodMap.evaluation_logic.sourceRefs ?? []), ...results.sourceRefs], 4);
  }

  const limitations = slides.find((slide) => slide.type === 'limitations');
  if (limitations && methodMap.limitations) {
    limitations.bullets = limitBullets(
      compactPresentationBullets([methodMap.limitations.author_stated, methodMap.limitations.inferred, ...limitations.bullets], 5),
      5
    );
    limitations.sourceRefs = compactRefs([...(methodMap.limitations.sourceRefs ?? []), ...limitations.sourceRefs], 4);
  }

  const innovation = slides.find((slide) => slide.type === 'innovation');
  if (innovation && methodMap.key_designs.length > 0) {
    innovation.bullets = limitBullets(
      methodMap.key_designs.map((design) =>
        normalizeInlineText(`${design.problem_it_solves} → ${design.name} → ${design.evidence}`, 120)
      ),
      5
    );
  }

  const summary = slides.find((slide) => slide.type === 'summary');
  if (summary) {
    summary.bullets = limitBullets(
      compactPresentationBullets(
        [
          methodMap.main_idea,
          ...methodMap.method_stages.slice(0, 3).map((stage) => `${stage.stage_name} 产出 ${stage.output}`),
          formatEvaluationLogic(methodMap.evaluation_logic)
        ],
        5
      ),
      5
    );
  }
}

function ensureContentSlideEvidenceDensity(slides: PresentationSlide[]): void {
  slides.forEach((slide) => {
    if (slide.type === 'cover' || slide.type === 'info' || slide.sourceRefs.length === 0) {
      return;
    }

    const minimumBulletCount = slide.type === 'summary' ? 2 : 3;
    if (slide.bullets.length >= minimumBulletCount) {
      return;
    }

    const allowFormulaText = slide.type === 'formula';
    const evidenceBullets = buildEvidenceAwareBullets(slide.type, slide.sourceRefs, { allowFormulaText });
    const sentenceBullets = slide.sourceRefs.flatMap((ref) =>
      buildSentenceFallbackBullets(slide.type, ref, extractEvidenceTerms(ref.text), { allowFormulaText })
    );
    const rawSourceBullets = slide.sourceRefs.flatMap((ref) =>
      splitIntoShortBullets(ref.text)
        .filter((bullet) => isUsefulBulletText(bullet) || (allowFormulaText && isUsefulFormulaText(bullet)))
        .map((bullet) => withSourcePage(normalizeInlineText(bullet, 92), ref.pageNumber))
    );

    slide.bullets = limitBullets(
      compactPresentationBullets([...slide.bullets, ...evidenceBullets, ...sentenceBullets, ...rawSourceBullets], 5),
      5
    );
  });
}

function formatEvaluationLogic(logic: DeepMethodEvaluationLogic): string {
  return compactTextList(
    [
      logic.tasks_or_datasets ? `Tasks: ${logic.tasks_or_datasets}` : '',
      logic.baselines ? `Baselines: ${logic.baselines}` : '',
      logic.metrics ? `Metrics: ${logic.metrics}` : '',
      logic.what_the_results_prove || logic.main_results
    ],
    4
  ).join(' | ');
}

function compactRefs(refs: PresentationSourceRef[], limit: number): PresentationSourceRef[] {
  const seen = new Set<string>();
  const result: PresentationSourceRef[] = [];
  refs.forEach((ref) => {
    const key = `${ref.pageNumber}:${ref.section}:${ref.text.slice(0, 48)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(ref);
  });
  return result.slice(0, limit);
}

function classifyPaperType(methodTerms: EvidenceTerms, experimentTerms: EvidenceTerms, text: string): DeepMethodPaperType {
  if (/\breview|survey|perspective|overview of the literature\b/iu.test(text)) {
    return 'review';
  }
  if (
    methodTerms.methods.some((term) =>
      /planner|MPC|CBF|PPO|SAC|PINN|policy|world model|perception encoder|trajectory optimizer|VLA|VLM|PILOT/iu.test(term)
    ) ||
    /\balgorithm|controller|planner|policy|optimization|training objective\b/iu.test(text)
  ) {
    return 'algorithm';
  }
  if (/\bsystem|platform|robot foundation model|architecture\b/iu.test(text)) {
    return 'system';
  }
  if (experimentTerms.platforms.length > 0 || /\bapplication|real[-\s]?world|robot platform\b/iu.test(text)) {
    return 'application';
  }
  if (experimentTerms.metrics.length > 0 || /\bexperiment|evaluation|benchmark\b/iu.test(text)) {
    return 'experiment';
  }
  return 'other';
}

function buildPriorWorkLimitations(refs: PresentationSourceRef[], terms: EvidenceTerms): string[] {
  const limitationSentences = refs.flatMap((ref) =>
    splitIntoShortBullets(ref.text).filter((sentence) =>
      /prior|existing|traditional|baseline|lack|limited|struggle|insufficient|cannot|unstructured|gap|challenge/iu.test(sentence)
    )
  );
  return compactTextList(
    [
      ...limitationSentences,
      ...terms.observations.map((term) => `Prior work does not reliably use ${term}.`),
      ...terms.tasks.map((term) => `Existing methods remain brittle on ${term}.`)
    ],
    4
  );
}

function buildTrainingImplementation(
  primaryMethod: string,
  methodRefs: PresentationSourceRef[],
  experimentRefs: PresentationSourceRef[],
  methodTerms: EvidenceTerms,
  experimentTerms: EvidenceTerms
): DeepMethodTrainingImplementation {
  const candidateRefs = [...methodRefs, ...experimentRefs];
  const trainingRefs = compactRefs(
    candidateRefs.filter((ref) =>
      /train|training|reinforcement learning|behavior cloning|objective|loss|safety cost|waypoint/iu.test(`${ref.section} ${ref.text}`)
    ),
    4
  );
  const implementationRefs = compactRefs(
    candidateRefs.filter((ref) => /implementation|optimi[sz]er|optimi[sz]ation|built|construct|deploy/iu.test(`${ref.section} ${ref.text}`)),
    4
  );
  const refs = compactRefs(
    candidateRefs.filter((ref) =>
      /train|training|reinforcement learning|behavior cloning|objective|loss|implementation|optimi[sz]e|safety cost|waypoint/iu.test(ref.text)
    ),
    4
  );
  const fallbackRefs = trainingRefs.length > 0 ? trainingRefs : refs.length > 0 ? refs : implementationRefs.length > 0 ? implementationRefs : compactRefs(methodRefs, 3);
  const detailRefs = compactRefs([...fallbackRefs, ...methodRefs], 4);
  const sourceText = fallbackRefs.map((ref) => ref.text).join(' ');
  const source = buildSourceLabel(fallbackRefs[0]);
  const trainedOrBuilt = compactTextList([primaryMethod, ...methodTerms.methods, ...methodTerms.outputs], 4).join(' + ');
  const dataInputs =
    firstMatchingSentence(fallbackRefs, [/data|input|observation|demonstration|behavior cloning|waypoint|RGB-D|LiDAR|occupancy|safety cost/iu]) ??
    buildFallbackSentence('Training data or inputs', compactTextList([...methodTerms.observations, ...methodTerms.training, ...experimentTerms.training], 5), sourceText);
  const objective =
    firstMatchingSentence(fallbackRefs, [/objective|loss|reinforcement learning|safety cost|avoid collisions?|tracking|stability|optimi[sz]e/iu]) ??
    buildFallbackSentence('Training objective', compactTextList([...methodTerms.constraints, ...methodTerms.training, ...experimentTerms.metrics], 5), sourceText);
  const details =
    firstSpecificSentence(detailRefs, [/implementation|trained|behavior cloning|reinforcement learning|safety cost|waypoint|objective|policy|input|observation|encoder|planner/iu]) ??
    buildFallbackSentence('Implementation detail', compactTextList([...methodTerms.methods, ...methodTerms.commands, ...methodTerms.outputs], 5), sourceText);

  return {
    what_is_trained_or_built: trainedOrBuilt || primaryMethod || 'source method',
    data_or_inputs: dataInputs,
    objective_or_rules: objective,
    important_details: details,
    source,
    sourceRefs: fallbackRefs
  };
}

function buildEvaluationLogic(
  experimentRefs: PresentationSourceRef[],
  conclusionRefs: PresentationSourceRef[],
  experimentTerms: EvidenceTerms
): DeepMethodEvaluationLogic {
  const refs = compactRefs([...experimentRefs, ...conclusionRefs], 5);
  const sourceText = refs.map((ref) => ref.text).join(' ');
  const source = buildSourceLabel(refs[0]);
  const taskTerms = compactTextList([...experimentTerms.platforms, ...experimentTerms.tasks, ...experimentTerms.training], 6);
  const baselineTerms = compactTextList(experimentTerms.baselines, 5);
  const metricTerms = compactTextList(experimentTerms.metrics, 6);
  const tasksOrDatasets = buildEvaluationTasksLabel(taskTerms, sourceText);
  const resultSentence =
    firstSpecificSentence(refs, [/experiment|evaluate|compare|baseline|metric|success|tracking|stability|result|terrain traversability|collision|path efficiency/iu]) ??
    normalizeInlineText(sourceText, 160);
  const structuredResult = buildEvaluationResultLabel(taskTerms, baselineTerms, metricTerms, experimentTerms.training, sourceText);
  const proof = buildEvaluationProofLabel(metricTerms, taskTerms, resultSentence);

  return {
    tasks_or_datasets: tasksOrDatasets,
    baselines: baselineTerms.join(', ') || buildFallbackSentence('Baselines', baselineTerms, sourceText),
    metrics: metricTerms.join(', ') || buildFallbackSentence('Metrics', metricTerms, sourceText),
    main_results: structuredResult || resultSentence || 'The paper does not clearly report main results in the extracted text.',
    what_the_results_prove: proof || 'The extracted text does not clearly state what the results prove.',
    source,
    sourceRefs: refs
  };
}

function buildEvaluationTasksLabel(taskTerms: string[], sourceText: string): string {
  const phrase =
    sourceText.match(/\bmobile robot navigation tasks?\b/iu)?.[0] ??
    sourceText.match(/\bloco[-\s]?manipulation\b/iu)?.[0] ??
    sourceText.match(/\bwhole[-\s]?body control\b/iu)?.[0] ??
    sourceText.match(/\bterrain traversability\b/iu)?.[0];
  const terms = compactTextList([phrase ?? '', ...taskTerms], 6);
  return terms.join(', ') || buildFallbackSentence('Tasks or datasets', taskTerms, sourceText);
}

function buildEvaluationResultLabel(taskTerms: string[], baselineTerms: string[], metricTerms: string[], trainingTerms: string[], sourceText: string): string {
  const parts = compactTextList(
    [
      taskTerms.length > 0 ? `任务/平台：${joinTerms(taskTerms, 3)}` : '',
      baselineTerms.length > 0 ? `对比：${joinTerms(baselineTerms, 3)}` : '',
      metricTerms.length > 0 ? `指标：${joinTerms(metricTerms, 4)}` : '',
      trainingTerms.length > 0 ? `验证场景：${joinTerms(trainingTerms, 2)}` : ''
    ],
    4
  );
  if (parts.length > 0) {
    return parts.join('；');
  }
  return normalizeInlineText(sourceText, 140);
}

function buildEvaluationProofLabel(metricTerms: string[], taskTerms: string[], resultSentence: string | undefined): string {
  const concreteTerms = compactTextList([...metricTerms, ...taskTerms], 5);
  if (concreteTerms.length > 0) {
    return `结果主要支撑 ${joinTerms(concreteTerms, 4)} 这些结论`;
  }
  return resultSentence ? normalizeInlineText(resultSentence, 140) : '';
}

function buildLimitations(
  conclusionRefs: PresentationSourceRef[],
  experimentRefs: PresentationSourceRef[],
  conclusionTerms: EvidenceTerms
): DeepMethodLimitations {
  const explicitRefs = compactRefs(
    [...conclusionRefs, ...experimentRefs].filter((ref) =>
      /limitation|failure|weakness|depends on|may fail|future work|not cover|degraded|robustness|ablation/iu.test(ref.text)
    ),
    4
  );
  const refs = explicitRefs.length > 0 ? explicitRefs : compactRefs(conclusionRefs, 3);
  const sourceText = refs.map((ref) => ref.text).join(' ');
  const authorStated =
    firstMatchingSentence(refs, [/limitation|failure|weakness|depends on|may fail|future work|not cover|degraded/iu]) ?? '';
  const inferredTerms = compactTextList([...conclusionTerms.observations, ...conclusionTerms.platforms, ...conclusionTerms.metrics], 4);
  const inferred = authorStated
    ? ''
    : buildFallbackSentence('Evidence-backed risk', inferredTerms, sourceText || 'No explicit limitation sentence was extracted.');

  return {
    author_stated: authorStated,
    inferred,
    source: buildSourceLabel(refs[0]),
    sourceRefs: refs
  };
}

function buildSourceLabel(ref?: PresentationSourceRef): string {
  return ref ? `p. ${ref.pageNumber} · ${ref.section}` : 'PDF extracted text';
}

function buildMethodStagesFromEvidence(
  primaryMethod: string,
  methodRefs: PresentationSourceRef[],
  methodTerms: EvidenceTerms,
  experimentTerms: EvidenceTerms
): DeepMethodStage[] {
  const source = methodRefs[0];
  const sourceLabel = source ? `p. ${source.pageNumber} · ${source.section}` : 'PDF';
  const sourceRefs = source ? [source] : [];
  const observation =
    joinTerms(methodTerms.observations, 4) ||
    inferTermFromText(
      methodRefs,
      /LiDAR|elevation map|proprioceptive|perceptive|terrain[-\s]?aware|visual|language|RGB-D|occupancy map/iu
    ) ||
    '原文观测输入';
  const methodModules = compactTextList(
    methodTerms.methods.filter((term) => term.toLowerCase() !== primaryMethod.toLowerCase()),
    6
  );
  const modulePipeline = joinTerms(methodModules.length > 0 ? methodModules : methodTerms.methods, 6);
  const command =
    joinTerms(compactTextList([...methodTerms.commands, ...methodModules], 6), 6) ||
    modulePipeline ||
    inferTermFromText(
      methodRefs,
      /hybrid internal command|context conditioning|subgoal images|episode metadata|context encoder|MoE|perception encoder|world model|trajectory optimizer/iu
    ) ||
    '任务/上下文表示';
  const output =
    joinTerms(methodTerms.outputs, 3) ||
    inferTermFromText(methodRefs, /joint targets?|whole[-\s]?body (?:control )?actions?|control commands?|action output/iu) ||
    '动作或控制输出';
  const training = joinTerms(compactTextList([...methodTerms.training, ...experimentTerms.training], 4), 4) || '训练/实现细节';
  const methodName = primaryMethod || methodTerms.methods[0] || '本文方法';

  const stages: DeepMethodStage[] = [
    {
      stage_name: '输入与状态构建',
      input: observation,
      process: `${methodName} 将外部感知和机器人状态整理为可决策表示`,
      output: /LiDAR|elevation|terrain/iu.test(observation) ? 'terrain/elevation state' : `${observation} 表示`,
      purpose: '让策略看到任务所需的环境和机器人状态',
      connects_to_next: `把状态表示交给 ${command}`,
      source: sourceLabel,
      sourceRefs
    },
    {
      stage_name: '上下文/任务表示',
      input: `${observation} + ${command}`,
      process: `${modulePipeline || command} 将任务意图、子目标或上下文写入策略条件`,
      output: command,
      purpose: '把高层任务要求转成低层控制可使用的条件',
      connects_to_next: `条件表示驱动 ${methodName} 推理动作`,
      source: sourceLabel,
      sourceRefs
    },
    {
      stage_name: '策略推理与动作输出',
      input: command,
      process: `${modulePipeline || methodName} 执行策略/控制推理`,
      output,
      purpose: '产生可执行的机器人动作或控制命令',
      connects_to_next: `动作进入训练和实验评估闭环`,
      source: sourceLabel,
      sourceRefs
    },
    {
      stage_name: '训练与评估闭环',
      input: output,
      process: training,
      output: joinTerms(experimentTerms.metrics, 3) || '任务成功率、稳定性或跟踪指标',
      purpose: '验证方法是否真正解决原文提出的控制/泛化问题',
      connects_to_next: '形成实验结论和局限性讨论',
      source: methodRefs[1] ? `p. ${methodRefs[1].pageNumber} · ${methodRefs[1].section}` : sourceLabel,
      sourceRefs: compactRefs(methodRefs.slice(0, 2), 2)
    }
  ];

  return stages.filter((stage) => stage.input && stage.process && stage.output).slice(0, 4);
}

function buildKeyDesigns(refs: PresentationSourceRef[], terms: EvidenceTerms): DeepMethodKeyDesign[] {
  const designs = compactTextList([...terms.methods, ...terms.observations, ...terms.commands, ...terms.constraints], 5);
  return designs.slice(0, 4).map((name, index) => {
    const ref = refs[index] ?? refs[0];
    return {
      name,
      problem_it_solves: index === 0 ? '原文方法需要把具体场景信息送入策略' : '原文需要避免只停留在抽象任务描述',
      how_it_works: ref ? normalizeInlineText(ref.text, 120) : `${name} 来自原文方法描述`,
      evidence: ref ? `p. ${ref.pageNumber} · ${normalizeInlineText(ref.section, 40)}` : 'PDF 方法章节',
      source: ref ? `p. ${ref.pageNumber} · ${ref.section}` : 'PDF'
    };
  });
}

function buildDifficultyStatements(refs: PresentationSourceRef[]): string[] {
  return refs
    .map((ref) => firstSpecificSentence([ref], [/challenge|difficult|lack|insufficient|limited|unstructured|complex|问题|困难|不足/iu]))
    .filter((item): item is string => Boolean(item));
}

function firstSpecificSentence(refs: PresentationSourceRef[], patterns: RegExp[]): string | undefined {
  for (const ref of refs) {
    const sentences = splitIntoShortBullets(ref.text);
    const hit = sentences.find((sentence) => patterns.some((pattern) => pattern.test(sentence)));
    if (hit) {
      return normalizeInlineText(hit, 140);
    }
  }
  const fallback = refs.find((ref) => isUsefulBulletText(ref.text));
  return fallback ? normalizeInlineText(fallback.text, 140) : undefined;
}

function firstMatchingSentence(refs: PresentationSourceRef[], patterns: RegExp[]): string | undefined {
  for (const ref of refs) {
    const sentences = splitIntoShortBullets(ref.text);
    const hit = sentences.find((sentence) => patterns.some((pattern) => pattern.test(sentence)));
    if (hit) {
      return normalizeInlineText(hit, 140);
    }
  }
  return undefined;
}

function buildFallbackSentence(label: string, terms: string[], sourceText: string): string {
  if (terms.length > 0) {
    return `${label}：${terms.join('、')}`;
  }
  return normalizeInlineText(sourceText || `${label}：原文未明确说明`, 140);
}

function inferTermFromText(refs: PresentationSourceRef[], pattern: RegExp): string | undefined {
  const match = refs.map((ref) => ref.text.match(pattern)?.[0]).find(Boolean);
  return match ? normalizeInlineText(match, 60) : undefined;
}

function selectSlidesForTargetCount(slides: PresentationSlide[], targetCount: number): PresentationSlide[] {
  if (targetCount >= slides.length) {
    return slides;
  }

  const priority: PresentationSlideType[] = [
    'cover',
    'info',
    'background',
    'method',
    'experiments',
    'results',
    'limitations',
    'summary',
    'innovation',
    'inspiration',
    'relatedWork',
    'formula'
  ];
  const priorityIndex = new Map(priority.map((type, index) => [type, index]));
  const slideOrder = new Map(slides.map((slide, index) => [slide.id, index]));

  return [...slides]
    .sort((left, right) => {
      const leftPriority = priorityIndex.get(left.type) ?? priority.length;
      const rightPriority = priorityIndex.get(right.type) ?? priority.length;
      return leftPriority - rightPriority;
    })
    .slice(0, targetCount)
    .sort((left, right) => (slideOrder.get(left.id) ?? 0) - (slideOrder.get(right.id) ?? 0));
}

function bucketSections(blocks: ExtractedPdfBlock[]): SectionBuckets {
  const buckets: SectionBuckets = {
    abstract: createBucket('Abstract'),
    introduction: createBucket('Introduction'),
    relatedWork: createBucket('Related Work'),
    method: createBucket('Method'),
    formula: createBucket('Formula'),
    experiments: createBucket('Experiments'),
    results: createBucket('Results'),
    conclusion: createBucket('Conclusion'),
    limitations: createBucket('Limitations')
  };

  blocks
    .filter((block) => block.type === 'paragraph' || block.type === 'formula')
    .filter((block) => !isReferenceSection(block.section))
    .filter((block) => isUsablePresentationNarrativeBlock(block))
    .forEach((block) => {
      const ref = toSourceRef(block);
      const sectionText = `${block.section} ${block.original}`;
      const sectionOnly = block.section;

      if (block.type === 'formula' || FORMULA_SECTION_PATTERN.test(sectionText)) {
        buckets.formula.refs.push(ref);
      } else if (ABSTRACT_SECTION_PATTERN.test(sectionOnly)) {
        buckets.abstract.refs.push(ref);
      } else if (RELATED_WORK_SECTION_PATTERN.test(sectionOnly)) {
        buckets.relatedWork.refs.push(ref);
      } else if (METHOD_SECTION_PATTERN.test(sectionOnly)) {
        buckets.method.refs.push(ref);
      } else if (EXPERIMENT_SECTION_PATTERN.test(sectionOnly)) {
        buckets.experiments.refs.push(ref);
      } else if (RESULT_SECTION_PATTERN.test(sectionOnly)) {
        buckets.results.refs.push(ref);
      } else if (CONCLUSION_SECTION_PATTERN.test(sectionOnly)) {
        buckets.conclusion.refs.push(ref);
      } else if (LIMITATION_SECTION_PATTERN.test(sectionOnly)) {
        buckets.limitations.refs.push(ref);
      } else if (INTRO_SECTION_PATTERN.test(sectionOnly)) {
        buckets.introduction.refs.push(ref);
      } else if (ABSTRACT_SECTION_PATTERN.test(sectionText)) {
        buckets.abstract.refs.push(ref);
      } else if (RELATED_WORK_SECTION_PATTERN.test(sectionText)) {
        buckets.relatedWork.refs.push(ref);
      } else if (METHOD_SECTION_PATTERN.test(sectionText)) {
        buckets.method.refs.push(ref);
      } else if (RESULT_SECTION_PATTERN.test(sectionText)) {
        buckets.results.refs.push(ref);
      } else if (EXPERIMENT_SECTION_PATTERN.test(sectionText)) {
        buckets.experiments.refs.push(ref);
      } else if (CONCLUSION_SECTION_PATTERN.test(sectionText)) {
        buckets.conclusion.refs.push(ref);
      } else if (LIMITATION_SECTION_PATTERN.test(sectionText)) {
        buckets.limitations.refs.push(ref);
      } else if (INTRO_SECTION_PATTERN.test(sectionText)) {
        buckets.introduction.refs.push(ref);
      } else if (block.page <= 2 && buckets.introduction.refs.length < 4) {
        buckets.introduction.refs.push(ref);
      }
    });

  if (buckets.introduction.refs.length === 0 && buckets.abstract.refs.length > 0) {
    buckets.introduction.refs.push(...buckets.abstract.refs.slice(0, 3));
  }

  // 实验和结果章节在论文里经常合并，互相补位可以让组会页更稳定。
  if (buckets.results.refs.length === 0 && buckets.experiments.refs.length > 0) {
    buckets.results.refs.push(...buckets.experiments.refs.slice(0, 3));
  }
  if (buckets.experiments.refs.length === 0 && buckets.results.refs.length > 0) {
    buckets.experiments.refs.push(...buckets.results.refs.slice(0, 3));
  }

  return buckets;
}

function createBucket(name: string): SectionBucket {
  return { name, refs: [] };
}

function toSourceRef(block: ExtractedPdfBlock): PresentationSourceRef {
  return {
    pageNumber: block.page,
    section: block.section || `Page ${block.page}`,
    text: normalizeInlineText(stripSpacedHeadingPrefix(block.original), 360)
  };
}

function pickRefs(buckets: SectionBucket[], limit: number): PresentationSourceRef[] {
  const refs: PresentationSourceRef[] = [];

  buckets.forEach((bucket) => {
    [...bucket.refs].sort((left, right) => scorePresentationRef(right) - scorePresentationRef(left)).forEach((ref) => {
      if (refs.length < limit && !refs.some((item) => item.text === ref.text && item.pageNumber === ref.pageNumber)) {
        refs.push(ref);
      }
    });
  });

  return refs;
}

function pickFigures(
  figures: PresentationFigureCandidate[],
  type: PresentationSlideType,
  limit: number
): PresentationFigureCandidate[] {
  return figures.filter((figure) => figure.suggestedSlide === type).slice(0, limit);
}

function pickFiguresForTypes(
  figures: PresentationFigureCandidate[],
  types: PresentationSlideType[],
  limit: number
): PresentationFigureCandidate[] {
  return figures.filter((figure) => types.includes(figure.suggestedSlide)).slice(0, limit);
}

function refsToBullets(
  refs: PresentationSourceRef[],
  options: { allowFormulaText?: boolean } = {}
): string[] {
  return refs.flatMap((ref) =>
    splitIntoShortBullets(ref.text)
      .filter((bullet) => isUsefulBulletText(bullet) || (options.allowFormulaText && isUsefulFormulaText(bullet)))
      .map((bullet) => `${bullet}（p. ${ref.pageNumber}）`)
  );
}

interface EvidenceTerms {
  methods: string[];
  observations: string[];
  commands: string[];
  outputs: string[];
  platforms: string[];
  tasks: string[];
  training: string[];
  baselines: string[];
  metrics: string[];
  constraints: string[];
  formulas: string[];
}

const GENERIC_PRESENTATION_BULLET_PATTERNS = [
  /框架串联感知、策略、执行/u,
  /任务指令转成机器人策略/u,
  /方法强调模型、控制和执行协同/u,
  /论文信息|研究对象|论点|方法线索|汇报目标/u,
  /增强泛化能力/u
];

const EVIDENCE_DICTIONARY = {
  methods: [
    { pattern: /\bPILOT\b/u, label: 'PILOT' },
    { pattern: /\brobot foundation model\b/iu, label: 'robot foundation model' },
    { pattern: /π0\.?7|pi0\.?7/iu, label: 'π0.7' },
    { pattern: /\bVLA\b|\bvision[-\s]?language[-\s]?action\b/iu, label: 'VLA' },
    { pattern: /\bVLM\b|\bvision[-\s]?language\b/iu, label: 'VLM' },
    { pattern: /\bPINN\b|\bphysics[-\s]?informed\b/iu, label: 'PINN' },
    { pattern: /\bCBF\b|\bcontrol barrier function\b/iu, label: 'CBF' },
    { pattern: /\bMPC\b|\bmodel predictive control\b/iu, label: 'MPC' },
    { pattern: /\bPPO\b/u, label: 'PPO' },
    { pattern: /\bSAC\b/u, label: 'SAC' },
    { pattern: /\bworld model\b/iu, label: 'World Model' },
    { pattern: /\bcross[-\s]?modal context encoders?\b/iu, label: 'cross-modal context encoder' },
    { pattern: /\bMixture[-\s]?of[-\s]?Experts\b|\bMoE\b/iu, label: 'Mixture-of-Experts (MoE)' },
    { pattern: /\bMoE policies?\b/iu, label: 'MoE policy' },
    { pattern: /\bprediction[-\s]?based perception\b|\bprediction[-\s]?based perceptive representations?\b/iu, label: 'prediction-based perceptive representation' },
    { pattern: /\bperception encoders?\b/iu, label: 'perception encoder' },
    { pattern: /\blatent dynamics\b/iu, label: 'latent dynamics' },
    { pattern: /\btrajectory optimizers?\b/iu, label: 'trajectory optimizer' },
    { pattern: /\bpolicy networks?\b/iu, label: 'policy network' },
    { pattern: /\blow[-\s]?level controllers?\b/iu, label: 'low-level controller' },
    { pattern: /\bplanners?\b/iu, label: 'planner' }
  ],
  observations: [
    { pattern: /\bRGB[-\s]?D observations?\b|\bRGB[-\s]?D inputs?\b/iu, label: 'RGB-D observations' },
    { pattern: /\bLiDAR[-\s]?based elevation maps?\b/iu, label: 'LiDAR-based elevation map' },
    { pattern: /\belevation maps?\b/iu, label: 'elevation map' },
    { pattern: /\boccupancy maps?\b/iu, label: 'occupancy map' },
    { pattern: /\bcost maps?\b/iu, label: 'cost map' },
    { pattern: /\bterrain[-\s]?aware perceptive features?\b/iu, label: 'terrain-aware perceptive features' },
    { pattern: /\bperceptive features?\b/iu, label: 'perceptive features' },
    { pattern: /\bprediction[-\s]?based perceptive representations?\b/iu, label: 'prediction-based perceptive representation' },
    { pattern: /\bproprioceptive states?\b|\bproprioception\b/iu, label: 'proprioception' },
    { pattern: /\bRGB observations?\b|\bRGB images?\b/iu, label: 'RGB observations' },
    { pattern: /\bvisual observations?\b|\bvision observations?\b/iu, label: 'visual observations' },
    { pattern: /\blanguage (instructions?|goals?|commands?)\b/iu, label: 'language instruction' },
    { pattern: /\bsubgoal images?\b/iu, label: 'subgoal images' },
    { pattern: /\bepisode metadata\b/iu, label: 'episode metadata' },
    { pattern: /\btask metadata\b/iu, label: 'task metadata' },
    { pattern: /\bpoint clouds?\b/iu, label: 'point cloud' }
  ],
  commands: [
    { pattern: /\bhybrid internal command(?: representation)?\b/iu, label: 'hybrid internal command' },
    { pattern: /\binternal command(?: representation)?\b/iu, label: 'internal command' },
    { pattern: /\bhigh[-\s]?level policy prompts?\b/iu, label: 'high-level policy prompt' },
    { pattern: /\bcontext conditioning\b/iu, label: 'context conditioning' },
    { pattern: /\bsubtask instructions?\b/iu, label: 'subtask instruction' },
    { pattern: /\btask commands?\b/iu, label: 'task command' },
    { pattern: /\bwaypoints?\b/iu, label: 'waypoint' },
    { pattern: /\blanguage goals?\b/iu, label: 'language goal' }
  ],
  outputs: [
    { pattern: /\bwhole[-\s]?body actions?\b/iu, label: 'whole-body action' },
    { pattern: /\bwhole[-\s]?body control actions?\b/iu, label: 'whole-body control action' },
    { pattern: /\bjoint targets?\b/iu, label: 'joint target' },
    { pattern: /\blow[-\s]?level robot actions?\b/iu, label: 'low-level action' },
    { pattern: /\baction outputs?\b/iu, label: 'action output' },
    { pattern: /\bcommand tracking\b/iu, label: 'command tracking' },
    { pattern: /\btrajectory\b/iu, label: 'trajectory' },
    { pattern: /\bcontrol commands?\b/iu, label: 'control command' },
    { pattern: /\bvelocity commands?\b/iu, label: 'velocity command' },
    { pattern: /\btarget poses?\b/iu, label: 'target pose' }
  ],
  platforms: [
    { pattern: /\bUnitree\s*G1\b/iu, label: 'Unitree G1' },
    { pattern: /\bhumanoid robots?\b/iu, label: 'humanoid robot' },
    { pattern: /\bphysical robot\b|\breal[-\s]?world robot\b/iu, label: 'real robot' },
    { pattern: /\bmultiple robot platforms?\b/iu, label: 'multiple robot platforms' },
    { pattern: /\bmobile robots?\b/iu, label: 'mobile robot' },
    { pattern: /\bquadruped robots?\b/iu, label: 'quadruped robot' }
  ],
  tasks: [
    { pattern: /\bloco[-\s]?manipulation\b/iu, label: 'loco-manipulation' },
    { pattern: /\bwhole[-\s]?body control\b/iu, label: 'whole-body control' },
    { pattern: /\bdexterous manipulation\b/iu, label: 'dexterous manipulation' },
    { pattern: /\bunstructured scenes?\b|\bunstructured environments?\b/iu, label: 'unstructured scenes' },
    { pattern: /\bterrain traversability\b/iu, label: 'terrain traversability' },
    { pattern: /\bobstacle crossing\b/iu, label: 'obstacle crossing' },
    { pattern: /\bslope traversal\b/iu, label: 'slope traversal' },
    { pattern: /\bnarrow passage\b/iu, label: 'narrow passage' },
    { pattern: /\bobject transport\b/iu, label: 'object transport' },
    { pattern: /\bdaily service tasks?\b/iu, label: 'daily service tasks' },
    { pattern: /\bnavigation\b/iu, label: 'navigation' },
    { pattern: /\bpath planning\b/iu, label: 'path planning' },
    { pattern: /\blong[-\s]?horizon\b/iu, label: 'long-horizon tasks' }
  ],
  training: [
    { pattern: /\breinforcement learning\b|\bRL\b/u, label: 'reinforcement learning' },
    { pattern: /\bimitation learning\b/iu, label: 'imitation learning' },
    { pattern: /\bdemonstrations?\b/iu, label: 'demonstrations' },
    { pattern: /\bautonomous data\b/iu, label: 'autonomous data' },
    { pattern: /\bmultimodal web data\b/iu, label: 'multimodal web data' },
    { pattern: /\bbehavior cloning\b/iu, label: 'behavior cloning' },
    { pattern: /\bsafety cost objective\b|\bsafety cost\b/iu, label: 'safety cost objective' },
    { pattern: /\bsimulation\b/iu, label: 'simulation' },
    { pattern: /\breal[-\s]?world\b/iu, label: 'real-world data' },
    { pattern: /\bpre[-\s]?training\b/iu, label: 'pre-training' }
  ],
  baselines: [
    { pattern: /\bblind baseline(?: controllers?)?\b/iu, label: 'blind baseline' },
    { pattern: /\bexisting baselines?\b/iu, label: 'existing baselines' },
    { pattern: /\bspecialist policies\b/iu, label: 'specialist policies' },
    { pattern: /\bimitation learning baselines?\b/iu, label: 'imitation learning baselines' },
    { pattern: /\bPPO\b/u, label: 'PPO' },
    { pattern: /\bSAC\b/u, label: 'SAC' },
    { pattern: /\bMPC\b/u, label: 'MPC' },
    { pattern: /\bCBF\b/u, label: 'CBF' }
  ],
  metrics: [
    { pattern: /\bsuccess rate\b/iu, label: 'success rate' },
    { pattern: /\bcollision rate\b/iu, label: 'collision rate' },
    { pattern: /\bpath efficiency\b/iu, label: 'path efficiency' },
    { pattern: /\bstability\b/iu, label: 'stability' },
    { pattern: /\bfall rate\b/iu, label: 'fall rate' },
    { pattern: /\bR_tracking\b/iu, label: 'R_tracking' },
    { pattern: /\bR_stability\b/iu, label: 'R_stability' },
    { pattern: /\bC_collision\b/iu, label: 'C_collision' },
    { pattern: /\bcommand tracking(?: precision)?\b/iu, label: 'command tracking precision' },
    { pattern: /\bterrain traversability\b/iu, label: 'terrain traversability' },
    { pattern: /\bcompositional generalization\b/iu, label: 'compositional generalization' },
    { pattern: /\btracking error\b/iu, label: 'tracking error' },
    { pattern: /\bgeneralization\b/iu, label: 'generalization' },
    { pattern: /\brobustness\b/iu, label: 'robustness' }
  ],
  constraints: [
    { pattern: /\bsafety constraints?\b/iu, label: 'safety constraint' },
    { pattern: /\bphysical constraints?\b/iu, label: 'physical constraint' },
    { pattern: /\bcontrol barrier function\b|\bCBF\b/u, label: 'CBF safety constraint' },
    { pattern: /\bsafety cost objective\b|\bsafety cost\b/iu, label: 'safety cost objective' },
    { pattern: /\bloss functions?\b|\bloss\b/iu, label: 'loss objective' },
    { pattern: /\bobjective function\b|\bobjective\b/iu, label: 'objective function' }
  ]
} as const;

function buildEvidenceAwareBullets(
  type: PresentationSlideType,
  refs: PresentationSourceRef[],
  options: { allowFormulaText?: boolean } = {}
): string[] {
  const candidates: string[] = [];

  refs.forEach((ref) => {
    const terms = extractEvidenceTerms(ref.text);
    candidates.push(...buildEvidenceBulletsForRef(type, ref, terms, options));

    if (candidates.length < 4) {
      candidates.push(...buildSentenceFallbackBullets(type, ref, terms, options));
    }
  });

  return compactPresentationBullets(candidates, 5);
}

function buildEvidenceBulletsForRef(
  type: PresentationSlideType,
  ref: PresentationSourceRef,
  terms: EvidenceTerms,
  options: { allowFormulaText?: boolean }
): string[] {
  const page = ref.pageNumber;
  const method = terms.methods[0];
  const bullets: string[] = [];

  if (type === 'method') {
    if (method && terms.tasks[0]) {
      bullets.push(withSourcePage(`${method} 面向 ${terms.tasks[0]} 做统一控制`, page));
    }
    if (terms.observations.length > 0) {
      bullets.push(withSourcePage(`输入侧使用 ${joinTerms(terms.observations, 2)} 感知状态`, page));
    }
    if (terms.commands.length > 0) {
      bullets.push(withSourcePage(`${joinTerms(terms.commands, 2)} 连接任务意图与全身控制`, page));
    }
    if (terms.outputs.length > 0) {
      bullets.push(withSourcePage(`输出侧服务 ${joinTerms(terms.outputs, 2)}`, page));
    }
    if (terms.training.length > 0) {
      bullets.push(withSourcePage(`训练信号来自 ${joinTerms(terms.training, 2)}`, page));
    }
  } else if (type === 'formula') {
    if (terms.formulas.length > 0) {
      bullets.push(...terms.formulas.slice(0, 2).map((formula) => withSourcePage(`核心公式：${formula}`, page)));
    }
    if (terms.constraints.length > 0) {
      bullets.push(withSourcePage(`目标项约束 ${joinTerms(terms.constraints, 2)}`, page));
    }
    if (terms.training.length > 0) {
      bullets.push(withSourcePage(`训练目标关联 ${joinTerms(terms.training, 2)}`, page));
    }
  } else if (type === 'experiments' || type === 'results') {
    if (terms.platforms.length > 0) {
      bullets.push(withSourcePage(`${joinTerms(terms.platforms, 2)} 用于真机/平台验证`, page));
    }
    if (terms.tasks.length > 0) {
      bullets.push(withSourcePage(`任务覆盖 ${joinTerms(terms.tasks, 2)}`, page));
    }
    if (terms.baselines.length > 0) {
      bullets.push(withSourcePage(`对比对象包含 ${joinTerms(terms.baselines, 2)}`, page));
    }
    if (terms.metrics.length > 0) {
      bullets.push(withSourcePage(`指标关注 ${joinTerms(terms.metrics, 3)}`, page));
    }
    if (terms.training.includes('simulation') || terms.training.includes('real-world data')) {
      bullets.push(withSourcePage(`验证覆盖 ${joinTerms(terms.training, 2)} 场景`, page));
    }
  } else if (type === 'background' || type === 'relatedWork') {
    if (terms.platforms.length > 0 || terms.tasks.length > 0) {
      bullets.push(withSourcePage(`问题场景是 ${joinTerms([...terms.platforms, ...terms.tasks], 2)}`, page));
    }
    if (terms.observations.length > 0) {
      bullets.push(withSourcePage(`难点来自 ${joinTerms(terms.observations, 2)} 与环境状态`, page));
    }
    if (terms.metrics.length > 0) {
      bullets.push(withSourcePage(`现有方法仍受 ${joinTerms(terms.metrics, 2)} 约束`, page));
    }
  } else if (type === 'innovation') {
    if (method && terms.observations.length > 0) {
      bullets.push(withSourcePage(`${method} 的差异点在 ${joinTerms(terms.observations, 2)}`, page));
    }
    if (terms.commands.length > 0) {
      bullets.push(withSourcePage(`${joinTerms(terms.commands, 2)} 是可验证贡献`, page));
    }
    if (terms.metrics.length > 0) {
      bullets.push(withSourcePage(`贡献用 ${joinTerms(terms.metrics, 2)} 支撑`, page));
    }
  } else if (type === 'limitations') {
    const riskTerms = [...terms.observations, ...terms.platforms, ...terms.metrics].slice(0, 2);
    if (riskTerms.length > 0) {
      bullets.push(withSourcePage(`边界需关注 ${joinTerms(riskTerms, 2)}`, page));
    }
  } else if (type === 'inspiration') {
    if (terms.methods.length > 0) {
      bullets.push(withSourcePage(`可复用 ${joinTerms(terms.methods, 2)} 作为 baseline`, page));
    }
    if (terms.metrics.length > 0) {
      bullets.push(withSourcePage(`评价可借鉴 ${joinTerms(terms.metrics, 2)}`, page));
    }
    if (terms.tasks.length > 0) {
      bullets.push(withSourcePage(`课题迁移到 ${joinTerms(terms.tasks, 2)}`, page));
    }
  } else if (type === 'summary') {
    if (method && terms.tasks.length > 0) {
      bullets.push(withSourcePage(`${method} 的核心价值在 ${terms.tasks[0]}`, page));
    }
    if (terms.metrics.length > 0) {
      bullets.push(withSourcePage(`是否复现看 ${joinTerms(terms.metrics, 2)}`, page));
    }
  }

  if (options.allowFormulaText && terms.formulas.length > 0) {
    bullets.push(...terms.formulas.slice(0, 2).map((formula) => withSourcePage(`公式证据：${formula}`, page)));
  }

  return bullets;
}

function buildSentenceFallbackBullets(
  type: PresentationSlideType,
  ref: PresentationSourceRef,
  terms: EvidenceTerms,
  options: { allowFormulaText?: boolean }
): string[] {
  if (type !== 'info' && !options.allowFormulaText && terms.formulas.length > 0) {
    return [];
  }

  return splitIntoShortBullets(ref.text)
    .filter((bullet) => isUsefulBulletText(bullet) || (options.allowFormulaText && isUsefulFormulaText(bullet)))
    .map((bullet) => rewriteSentenceAsSeminarBullet(type, bullet, ref, terms))
    .filter(Boolean);
}

function rewriteSentenceAsSeminarBullet(
  type: PresentationSlideType,
  sentence: string,
  ref: PresentationSourceRef,
  terms: EvidenceTerms
): string {
  const lower = sentence.toLowerCase();
  const page = ref.pageNumber;

  if (type === 'formula' && terms.formulas.length > 0) {
    return withSourcePage(`公式/目标：${terms.formulas[0]}`, page);
  }
  if (/\bchallenge|lack|difficult|insufficient|unresolved|complex|unstructured\b/iu.test(lower)) {
    const target = joinTerms([...terms.platforms, ...terms.tasks, ...terms.observations], 2);
    return withSourcePage(target ? `核心瓶颈是 ${target}` : `原文指出 ${normalizeInlineText(sentence, 46)}`, page);
  }
  if (/\bpropose|present|introduce|incorporate|use|combine\b/iu.test(lower)) {
    const parts = joinTerms([...terms.methods, ...terms.observations, ...terms.commands, ...terms.outputs], 3);
    return withSourcePage(parts ? `方法具体包含 ${parts}` : `方法证据：${normalizeInlineText(sentence, 44)}`, page);
  }
  if (/\bevaluate|experiment|validate|compare|result|baseline|metric\b/iu.test(lower)) {
    const parts = joinTerms([...terms.platforms, ...terms.baselines, ...terms.metrics], 3);
    return withSourcePage(parts ? `实验验证 ${parts}` : `实验信息：${normalizeInlineText(sentence, 44)}`, page);
  }

  if (asciiRatio(sentence) > 0.55) {
    const parts = joinTerms([...terms.methods, ...terms.tasks, ...terms.metrics], 2);
    return withSourcePage(parts ? `原文证据指向 ${parts}` : `原文要点：${normalizeInlineText(sentence, 42)}`, page);
  }

  return withSourcePage(sentence, page);
}

function extractEvidenceTerms(text: string): EvidenceTerms {
  return {
    methods: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.methods),
    observations: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.observations),
    commands: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.commands),
    outputs: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.outputs),
    platforms: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.platforms),
    tasks: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.tasks),
    training: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.training),
    baselines: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.baselines),
    metrics: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.metrics),
    constraints: extractDictionaryMatches(text, EVIDENCE_DICTIONARY.constraints),
    formulas: extractFormulaSnippets(text)
  };
}

function extractDictionaryMatches(text: string, entries: readonly { pattern: RegExp; label: string }[]): string[] {
  return compactTextList(entries.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label), 6);
}

function extractFormulaSnippets(text: string): string[] {
  if (!isUsefulFormulaText(text) && !/[=+\-*/^_{}]/u.test(text)) {
    return [];
  }

  return splitIntoShortBullets(text)
    .filter((part) => /[=+\-*/^_{}]/u.test(part))
    .map((part) => normalizeInlineText(part, 92))
    .slice(0, 3);
}

function compactPresentationBullets(items: string[], limit: number): string[] {
  const result: string[] = [];
  items.forEach((item) => {
    const normalized = normalizeInlineText(item, 150);
    if (!normalized || GENERIC_PRESENTATION_BULLET_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return;
    }
    const key = normalized.replace(/（p\.\s*\d+）/u, '').toLowerCase();
    if (result.some((existing) => existing.replace(/（p\.\s*\d+）/u, '').toLowerCase() === key)) {
      return;
    }
    result.push(normalized);
  });
  return result.slice(0, limit);
}

function withSourcePage(text: string, pageNumber: number): string {
  return `${normalizeInlineText(text, 112)}（p. ${pageNumber}）`;
}

function joinTerms(terms: string[], limit: number): string {
  return compactTextList(terms, limit).join('、');
}

function compactTextList(items: string[], limit: number): string[] {
  const result: string[] = [];
  items.forEach((item) => {
    const normalized = item.trim();
    if (!normalized || result.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    result.push(normalized);
  });
  return result.slice(0, limit);
}

function splitIntoShortBullets(text: string): string[] {
  const normalized = normalizeInlineText(text, 520);
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks = sentences.length > 1 ? sentences : splitLongSentenceIntoBulletChunks(sentences[0] ?? normalized);
  return chunks.slice(0, 2).map((chunk) => normalizeInlineText(chunk, 150));
}

function splitLongSentenceIntoBulletChunks(sentence: string): string[] {
  const normalized = sentence.trim();
  if (normalized.length <= 145) {
    return [normalized];
  }

  const clauses = normalized
    .split(/(?<=,|;|；)\s+|\s+(?:and|but|while|whereas|because|including|without)\s+/iu)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 18);

  if (clauses.length <= 1) {
    return [normalized];
  }

  const chunks: string[] = [];
  let current = '';

  clauses.forEach((clause) => {
    const next = current ? `${current} ${clause}` : clause;
    if (next.length <= 135) {
      current = next;
      return;
    }

    if (current) {
      chunks.push(current);
    }
    current = clause;
  });

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [normalized];
}

function limitBullets(bullets: string[], limit: number): string[] {
  return bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, limit);
}

function isUsablePresentationBlock(block: ExtractedPdfBlock): boolean {
  if (isReferenceSection(block.section)) {
    return false;
  }
  if (block.type === 'formula') {
    return normalizeInlineText(block.original, 999).length >= 4;
  }
  return normalizeInlineText(block.original, 999).length >= 12;
}

function isUsablePresentationNarrativeBlock(block: ExtractedPdfBlock): boolean {
  const text = normalizeInlineText(block.original, 1200);

  if (block.type === 'formula') {
    return isUsefulFormulaText(text);
  }

  if (text.length < 55 || countTextWords(text) < 8) {
    return false;
  }

  if (
    CAPTION_PATTERN.test(text) ||
    looksLikePseudoCode(text) ||
    looksLikeFormulaFragment(text) ||
    looksLikeFigureLabel(text) ||
    looksLikeDiagramLabelText(text)
  ) {
    return false;
  }

  return /[.!?。！？]/u.test(text) || countTextWords(text) >= 16;
}

function isUsefulFormulaText(text: string): boolean {
  if (looksLikePseudoCode(text) || looksLikeDiagramLabelText(text)) {
    return false;
  }

  return /[=+\-*/^_{}]/u.test(text) && countTextWords(text) <= 28;
}

function isUsefulBulletText(text: string): boolean {
  const normalized = normalizeInlineText(text, 300);
  const words = countTextWords(normalized);
  return (
    normalized.length >= 24 &&
    words >= 7 &&
    !looksLikePseudoCode(normalized) &&
    !looksLikeFormulaFragment(normalized) &&
    !looksLikeFigureLabel(normalized) &&
    !looksLikeDiagramLabelText(normalized)
  );
}

function scorePresentationRef(ref: PresentationSourceRef): number {
  const text = ref.text.toLowerCase();
  let score = 0;

  if (/\b(we|this paper|our|propose|present|introduce|evaluate|experiment|result|method|model|framework|baseline|improve|challenge)\b/u.test(text)) {
    score += 4;
  }
  if (/\b(problem|limitation|existing|prior|generalization|performance|dataset|task|robot|policy|training)\b/u.test(text)) {
    score += 2;
  }
  if (ref.text.length >= 90 && ref.text.length <= 280) {
    score += 2;
  }
  if (
    looksLikePseudoCode(ref.text) ||
    looksLikeFormulaFragment(ref.text) ||
    looksLikeFigureLabel(ref.text) ||
    looksLikeDiagramLabelText(ref.text)
  ) {
    score -= 8;
  }
  if (ref.pageNumber <= 2) {
    score += 1;
  }

  return score;
}

function looksLikePseudoCode(text: string): boolean {
  const normalized = text.trim();
  return (
    /^\d+\s*:/u.test(normalized) ||
    /\b(end\s+if|for\s+\w+\s*=|if\s+.+\s+then|async|timer elapsed|non-blocking|return\s+)/iu.test(normalized) ||
    /[▷▶]/u.test(normalized)
  );
}

function looksLikeFormulaFragment(text: string): boolean {
  const symbols = (text.match(/[=<>≤≥≈∼∑∏√^_{}[\]|\\]/gu) ?? []).length;
  const words = countTextWords(text);
  return symbols >= 4 && symbols > words * 0.35;
}

function looksLikeFigureLabel(text: string): boolean {
  const words = countTextWords(text);
  if (words > 14) {
    return false;
  }

  return /\b(prompt|metadata|subgoal|image|episode|expert|observation|memory|world)\b/iu.test(text);
}

function looksLikeDiagramLabelText(text: string): boolean {
  const normalized = normalizeInlineText(text, 500).toLowerCase();
  const words = countTextWords(normalized);
  const labelMatches =
    normalized.match(
      /\b(subtask|task instruction|prompt|metadata|action expert|world model|high-level policy|language instructions|subgoal images|observation memory|robot data|non-robot data|autonomous data|egocentric human data|demonstration data|episode metadata|quality|actions|noise|current observation)\b/giu
    ) ?? [];
  const academicCue =
    /\b(we|our|this paper|propose|present|introduce|evaluate|experiment|result|method|training|dataset|performance|generalization|capabilities|tasks|robotic foundation model)\b/iu.test(
      normalized
    );

  if (words <= 16 && labelMatches.length >= 1 && !academicCue) {
    return true;
  }

  return words <= 34 && labelMatches.length >= 3 && !academicCue;
}

function countTextWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function asciiRatio(text: string): number {
  if (!text) {
    return 0;
  }
  const ascii = text.match(/[A-Za-z]/gu)?.length ?? 0;
  return ascii / text.length;
}

function isReferenceSection(section: string): boolean {
  return REFERENCE_SECTION_PATTERN.test(section.trim());
}

function classifyFigureKind(text: string): PresentationFigureKind {
  if (/result|quantitative|comparison|performance|ablation|success\s*rate|tracking|stability|benchmark|evaluation|metric|score|accuracy|table/iu.test(text)) {
    return 'result';
  }
  if (/architecture|overview|framework|pipeline|method|model|algorithm|system|module|process|controller|policy/iu.test(text)) {
    return 'method';
  }
  if (/loss|equation|formula|objective|optimization|gradient/iu.test(text)) {
    return 'formula';
  }
  if (/robot|platform|task|environment|dataset|setup|illustration|example|demonstration|scene/iu.test(text)) {
    return 'setup';
  }
  if (/failure|case|qualitative|visualization|example/iu.test(text)) {
    return 'case';
  }
  return 'unknown';
}

function suggestFigureSlide(text: string, figureKind: PresentationFigureKind = classifyFigureKind(text)): PresentationSlideType {
  if (figureKind === 'result') {
    return 'results';
  }
  if (figureKind === 'setup') {
    return 'experiments';
  }
  if (figureKind === 'formula') {
    return 'formula';
  }
  if (figureKind === 'case') {
    return 'limitations';
  }
  return 'method';
}

function getFigureReason(type: PresentationSlideType, figureKind: PresentationFigureKind = 'unknown'): string {
  if (figureKind === 'result') {
    return '结果/对比/指标证据，优先用于结果页';
  }
  if (figureKind === 'setup') {
    return '平台/任务/环境示意，优先用于实验设置页';
  }
  if (type === 'experiments') {
    return '实验或结果页优先使用';
  }
  if (type === 'formula') {
    return '关键公式或目标函数页可使用';
  }
  return '方法框架页优先使用';
}

function normalizeInlineText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function stripSpacedHeadingPrefix(text: string): string {
  const normalized = normalizeInlineText(text, 1200);
  const match = normalized.match(
    /^(.{8,120}?)(\b(?:We|In|The|This|Our|To|For|During|After|At|Although|Because|Experiments|Evaluation)\b.+)$/u
  );

  if (!match) {
    return normalized;
  }

  const [, prefix, body] = match;
  const letters = prefix.match(/\p{L}/gu) ?? [];
  const lowerLetters = prefix.match(/\p{Ll}/gu) ?? [];
  const upperLetters = prefix.match(/\p{Lu}/gu) ?? [];
  const hasSpacedTitleNoise = /(?:\b[A-Z]\s+[A-Z]|\b[A-Z]{2,}\b|\b[IVX]+\.)/u.test(prefix);

  if (letters.length >= 5 && hasSpacedTitleNoise && upperLetters.length >= lowerLetters.length) {
    return body.trim();
  }

  return normalized;
}

function getPaperTitle(paper: PaperRecord | undefined): string {
  if (!paper) {
    return '未命名论文';
  }
  return paper.chineseTitle || paper.englishTitle || paper.pdfName.replace(/\.[^.]+$/u, '');
}

function getUsedPages(slides: PresentationSlide[]): number[] {
  return [...new Set(slides.flatMap((slide) => slide.sourceRefs.map((ref) => ref.pageNumber)))].sort((a, b) => a - b);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}
