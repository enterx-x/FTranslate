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
  selected?: boolean;
  suggestedReason?: string;
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

export interface PresentationDraft {
  id: string;
  title: string;
  subtitle: string;
  sourcePapers: PresentationSourcePaper[];
  figures: PresentationFigureCandidate[];
  slides: PresentationSlide[];
  createdAt: string;
}

export interface BuildPresentationDraftInput {
  papers: PaperRecord[];
  blocks: ExtractedPdfBlock[];
  targetSlideCount?: number;
  speakerName?: string;
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
const METHOD_SECTION_PATTERN = /method|approach|model|framework|algorithm|overview|architecture|方法|模型|算法|框架|结构/iu;
const FORMULA_SECTION_PATTERN = /formula|equation|objective|loss|公式|损失|目标函数/iu;
const EXPERIMENT_SECTION_PATTERN = /experiment|evaluation|dataset|benchmark|setting|ablation|实验|评估|数据集|基准|消融/iu;
const RESULT_SECTION_PATTERN = /result|quantitative|comparison|performance|结果|对比|性能/iu;
const CONCLUSION_SECTION_PATTERN = /conclusion|discussion|future|总结|结论|讨论|未来/iu;
const LIMITATION_SECTION_PATTERN = /limitation|failure|weakness|局限|不足|失败/iu;
const CAPTION_PATTERN = /^(fig\.?|figure|table|tab\.?)\s*\d+/iu;

export function buildPresentationDraft(input: BuildPresentationDraftInput): PresentationDraft {
  return buildLocalPresentationDraft(input);
}

export function buildLocalPresentationDraft(input: BuildPresentationDraftInput): PresentationDraft {
  const paper = input.papers[0];
  const title = getPaperTitle(paper);
  const usableBlocks = input.blocks.filter((block) => isUsablePresentationBlock(block));
  const figures = extractFigureCandidates(usableBlocks);
  const buckets = bucketSections(usableBlocks);

  const slides = [
    buildCoverSlide(title, paper, input.speakerName),
    buildInfoSlide(paper, buckets.abstract),
    buildContentSlide({
      id: 'slide-background',
      type: 'background',
      title: '研究背景与问题',
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
      title: '方法整体框架',
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
      figures: pickFigures(figures, 'formula', 1),
      fallback: '原文未明确说明关键公式，汇报时可只解释核心模块。',
      speakerNote: '只讲对方法理解必要的公式或模块，不堆满推导。'
    }),
    buildContentSlide({
      id: 'slide-experiments',
      type: 'experiments',
      title: '实验设置',
      section: 'Experiments',
      refs: pickRefs([buckets.experiments, buckets.results], 3),
      figures: pickFigures(figures, 'experiments', 1),
      fallback: '原文未明确说明实验设置。',
      speakerNote: '交代数据集、任务、对比方法和评价指标。'
    }),
    buildContentSlide({
      id: 'slide-results',
      type: 'results',
      title: '实验结果',
      section: 'Results',
      refs: pickRefs([buckets.results, buckets.experiments], 4),
      figures: pickFigures(figures, 'experiments', 2),
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

  const targetCount = Math.max(4, Math.min(slides.length, input.targetSlideCount ?? slides.length));
  const selectedSlides = selectSlidesForTargetCount(slides, targetCount);
  const usedPages = getUsedPages(selectedSlides);
  const usedFigureIds = selectedSlides.flatMap((slide) => slide.figures.map((figure) => figure.imageId));

  return {
    id: `presentation-${paper?.id ?? 'current'}-${Date.now()}`,
    title,
    subtitle: '研究生组会极简风格 PPT 草稿',
    sourcePapers: input.papers.map((item) => ({
      paperId: item.id,
      title: getPaperTitle(item),
      pdfPath: item.pdfPath,
      pagesUsed: usedPages,
      figuresUsed: usedFigureIds
    })),
    figures,
    slides: selectedSlides,
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

export function extractFigureCandidates(blocks: ExtractedPdfBlock[]): PresentationFigureCandidate[] {
  let figureIndex = 0;

  return blocks
    .filter((block) => block.type === 'caption' || CAPTION_PATTERN.test(block.original.trim()))
    .filter((block) => !isReferenceSection(block.section))
    .map((block) => {
      figureIndex += 1;
      const suggestedSlide = suggestFigureSlide(block.original);
      return {
        imageId: `fig-${block.page}-${figureIndex}`,
        pageNumber: block.page,
        caption: normalizeInlineText(block.original, 240),
        source: 'pdf-caption' as const,
        suggestedSlide,
        selected: true,
        suggestedReason: getFigureReason(suggestedSlide)
      };
    });
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
  const bullets = refsToBullets(options.refs);

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
    .forEach((block) => {
      const ref = toSourceRef(block);
      const sectionText = `${block.section} ${block.original}`;

      if (block.type === 'formula' || FORMULA_SECTION_PATTERN.test(sectionText)) {
        buckets.formula.refs.push(ref);
      } else if (ABSTRACT_SECTION_PATTERN.test(sectionText)) {
        buckets.abstract.refs.push(ref);
      } else if (RELATED_WORK_SECTION_PATTERN.test(sectionText)) {
        buckets.relatedWork.refs.push(ref);
      } else if (LIMITATION_SECTION_PATTERN.test(sectionText)) {
        buckets.limitations.refs.push(ref);
      } else if (METHOD_SECTION_PATTERN.test(sectionText)) {
        buckets.method.refs.push(ref);
      } else if (RESULT_SECTION_PATTERN.test(sectionText)) {
        buckets.results.refs.push(ref);
      } else if (EXPERIMENT_SECTION_PATTERN.test(sectionText)) {
        buckets.experiments.refs.push(ref);
      } else if (CONCLUSION_SECTION_PATTERN.test(sectionText)) {
        buckets.conclusion.refs.push(ref);
      } else if (INTRO_SECTION_PATTERN.test(sectionText)) {
        buckets.introduction.refs.push(ref);
      } else if (buckets.introduction.refs.length < 4) {
        buckets.introduction.refs.push(ref);
      }
    });

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
    text: normalizeInlineText(block.original, 360)
  };
}

function pickRefs(buckets: SectionBucket[], limit: number): PresentationSourceRef[] {
  const refs: PresentationSourceRef[] = [];

  buckets.forEach((bucket) => {
    bucket.refs.forEach((ref) => {
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

function refsToBullets(refs: PresentationSourceRef[]): string[] {
  return refs.flatMap((ref) =>
    splitIntoShortBullets(ref.text).map((bullet) => `${bullet}（p. ${ref.pageNumber}）`)
  );
}

function splitIntoShortBullets(text: string): string[] {
  const normalized = normalizeInlineText(text, 520);
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks = sentences.length > 0 ? sentences : [normalized];
  return chunks.slice(0, 2).map((chunk) => normalizeInlineText(chunk, 150));
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

function isReferenceSection(section: string): boolean {
  return REFERENCE_SECTION_PATTERN.test(section.trim());
}

function suggestFigureSlide(text: string): PresentationSlideType {
  if (/table|result|experiment|evaluation|ablation|quantitative|benchmark/iu.test(text)) {
    return 'experiments';
  }
  if (/loss|equation|formula|objective|gradient|optimization/iu.test(text)) {
    return 'formula';
  }
  return 'method';
}

function getFigureReason(type: PresentationSlideType): string {
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

function getPaperTitle(paper: PaperRecord | undefined): string {
  if (!paper) {
    return '未命名论文';
  }
  return paper.chineseTitle || paper.englishTitle || paper.pdfName.replace(/\.[^.]+$/u, '');
}

function getUsedPages(slides: PresentationSlide[]): number[] {
  return [...new Set(slides.flatMap((slide) => slide.sourceRefs.map((ref) => ref.pageNumber)))].sort((a, b) => a - b);
}
