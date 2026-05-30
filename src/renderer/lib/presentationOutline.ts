import type { ExtractedPdfBlock } from './pdfTextStructure';
import type { PaperRecord } from './papers';

export type PresentationSlideType =
  | 'cover'
  | 'info'
  | 'background'
  | 'method'
  | 'formula'
  | 'experiments'
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
}

export interface PresentationSlide {
  id: string;
  type: PresentationSlideType;
  title: string;
  subtitle?: string;
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

const REFERENCE_SECTION_PATTERN = /^(references?|bibliography|参考文献)\b/iu;
const ABSTRACT_SECTION_PATTERN = /abstract|摘要/iu;
const INTRO_SECTION_PATTERN = /intro|background|motivation|related work|引言|背景/iu;
const METHOD_SECTION_PATTERN = /method|approach|model|framework|algorithm|overview|方法|模型|算法|框架/iu;
const EXPERIMENT_SECTION_PATTERN = /experiment|result|evaluation|dataset|benchmark|实验|结果|评估/iu;
const CONCLUSION_SECTION_PATTERN = /conclusion|discussion|limitation|future|结论|讨论|局限|未来/iu;
const CAPTION_PATTERN = /^(fig\.?|figure|table|tab\.?)\s*\d+/iu;

export function buildPresentationDraft(input: BuildPresentationDraftInput): PresentationDraft {
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
      refs: pickRefs([buckets.introduction, buckets.abstract], 2),
      fallback: '原文未明确说明研究背景或问题。',
      speakerNote: '用一到两句话说明这篇论文的研究问题和为什么重要。'
    }),
    buildContentSlide({
      id: 'slide-method',
      type: 'method',
      title: '方法整体框架',
      refs: pickRefs([buckets.method, buckets.abstract], 2),
      figures: figures.filter((figure) => figure.suggestedSlide === 'method').slice(0, 1),
      fallback: '原文未明确说明方法框架。',
      speakerNote: '优先结合论文方法图解释输入、核心模块和输出。'
    }),
    buildContentSlide({
      id: 'slide-experiments',
      type: 'experiments',
      title: '实验设置与结果',
      refs: pickRefs([buckets.experiments], 2),
      figures: figures.filter((figure) => figure.suggestedSlide === 'experiments').slice(0, 1),
      fallback: '原文未明确说明实验设置或结果。',
      speakerNote: '强调对比方法、评价指标和最关键的结果，不夸大结论。'
    }),
    buildContentSlide({
      id: 'slide-innovation',
      type: 'innovation',
      title: '创新点总结',
      refs: pickRefs([buckets.abstract, buckets.method, buckets.conclusion], 3),
      fallback: '原文未明确说明创新点。',
      speakerNote: '说明相比前人工作真正不同的地方。'
    }),
    buildContentSlide({
      id: 'slide-limitations',
      type: 'limitations',
      title: '局限性与讨论',
      refs: pickRefs([buckets.conclusion, buckets.experiments], 2),
      fallback: '原文未明确说明局限性，可在汇报时谨慎补充个人判断。',
      speakerNote: '区分作者明确说明的局限和基于原文内容归纳的局限。'
    }),
    buildContentSlide({
      id: 'slide-inspiration',
      type: 'inspiration',
      title: '对我课题的启发',
      refs: pickRefs([buckets.method, buckets.experiments, buckets.conclusion], 3),
      fallback: '可结合自己的 RL、PINN、安全约束或路径规划课题补充启发。',
      speakerNote: '围绕可复用模块、可迁移实验设计和可作为 baseline 的方法。'
    }),
    buildContentSlide({
      id: 'slide-summary',
      type: 'summary',
      title: '总结',
      refs: pickRefs([buckets.abstract, buckets.conclusion], 2),
      fallback: '一句话总结这篇论文是否值得复现，以及下一步怎么做。',
      speakerNote: '最后明确是否值得深入复现，以及最值得借鉴的一点。'
    })
  ];

  const targetCount = Math.max(4, Math.min(12, input.targetSlideCount ?? slides.length));
  const selectedSlides = slides.slice(0, targetCount);
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
        lines.push(`- ${figure.caption}（来源：p. ${figure.pageNumber}）`);
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
      return {
        imageId: `fig-${block.page}-${figureIndex}`,
        pageNumber: block.page,
        caption: normalizeInlineText(block.original, 220),
        source: 'pdf-caption' as const,
        suggestedSlide: suggestFigureSlide(block.original)
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
    bullets: [],
    figures: [],
    sourceRefs: [],
    speakerNotes: '封面页保持简洁，说明论文来源和汇报背景。'
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
    bullets: limitBullets([...bullets, ...refsToBullets(abstractBucket.refs.slice(0, 1))], 5),
    figures: [],
    sourceRefs: abstractBucket.refs.slice(0, 1),
    speakerNotes: '简要交代论文主题、作者和发表信息。'
  };
}

function buildContentSlide(options: {
  id: string;
  type: PresentationSlideType;
  title: string;
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
    bullets: bullets.length > 0 ? limitBullets(bullets, 5) : [options.fallback],
    figures: options.figures ?? [],
    sourceRefs: options.refs,
    speakerNotes: options.speakerNote
  };
}

function bucketSections(blocks: ExtractedPdfBlock[]): Record<string, SectionBucket> {
  const buckets = {
    abstract: createBucket('Abstract'),
    introduction: createBucket('Introduction'),
    method: createBucket('Method'),
    experiments: createBucket('Experiments'),
    conclusion: createBucket('Conclusion')
  };

  blocks
    .filter((block) => block.type === 'paragraph')
    .filter((block) => !isReferenceSection(block.section))
    .forEach((block) => {
      const ref = toSourceRef(block);
      const sectionText = `${block.section} ${block.original}`;

      if (ABSTRACT_SECTION_PATTERN.test(sectionText)) {
        buckets.abstract.refs.push(ref);
      } else if (METHOD_SECTION_PATTERN.test(sectionText)) {
        buckets.method.refs.push(ref);
      } else if (EXPERIMENT_SECTION_PATTERN.test(sectionText)) {
        buckets.experiments.refs.push(ref);
      } else if (CONCLUSION_SECTION_PATTERN.test(sectionText)) {
        buckets.conclusion.refs.push(ref);
      } else if (INTRO_SECTION_PATTERN.test(sectionText)) {
        buckets.introduction.refs.push(ref);
      } else if (buckets.introduction.refs.length < 3) {
        buckets.introduction.refs.push(ref);
      }
    });

  return buckets;
}

function createBucket(name: string): SectionBucket {
  return { name, refs: [] };
}

function toSourceRef(block: ExtractedPdfBlock): PresentationSourceRef {
  return {
    pageNumber: block.page,
    section: block.section || `Page ${block.page}`,
    text: normalizeInlineText(block.original, 260)
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

function refsToBullets(refs: PresentationSourceRef[]): string[] {
  return refs.flatMap((ref) => splitIntoShortBullets(ref.text).map((bullet) => `${bullet}（p. ${ref.pageNumber}）`));
}

function splitIntoShortBullets(text: string): string[] {
  const normalized = normalizeInlineText(text, 420);
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks = sentences.length > 0 ? sentences : [normalized];
  return chunks.slice(0, 2).map((chunk) => normalizeInlineText(chunk, 120));
}

function limitBullets(bullets: string[], limit: number): string[] {
  return bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, limit);
}

function isUsablePresentationBlock(block: ExtractedPdfBlock): boolean {
  if (isReferenceSection(block.section)) {
    return false;
  }
  if (block.type === 'formula') {
    return false;
  }
  return normalizeInlineText(block.original, 999).length >= 12;
}

function isReferenceSection(section: string): boolean {
  return REFERENCE_SECTION_PATTERN.test(section.trim());
}

function suggestFigureSlide(text: string): PresentationSlideType {
  if (/table|result|experiment|evaluation|ablation|quantitative/iu.test(text)) {
    return 'experiments';
  }
  if (/loss|equation|formula|objective/iu.test(text)) {
    return 'formula';
  }
  return 'method';
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
