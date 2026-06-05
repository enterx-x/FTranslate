import { useEffect, useMemo, useState } from 'react';
import { MarkdownDocument } from './MarkdownDocument';
import {
  applyAiEnhancedPresentationDraft,
  buildPresentationAiEnhancementPrompt,
  serializePresentationMarkdown,
  type PresentationDraft,
  type PresentationSlide
} from '../lib/presentationOutline';
import {
  buildPresentationReviewReport,
  buildPptxEvidenceCards,
  buildPptxSlidePlan,
  type PptxEvidenceCard,
  type PptxSlidePlan
} from '../lib/presentationPptx';
import backIcon from '../assets/icons/duotone/back.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import refreshIcon from '../assets/icons/duotone/refresh.svg';
import saveIcon from '../assets/icons/duotone/save.svg';

interface PresentationPageProps {
  draft: PresentationDraft | null;
  onBackHome: () => void;
  onOpenReader: () => void;
  onRegenerate: () => void;
  onExportMarkdown: (draft: PresentationDraft) => void;
  onExportJson: (draft: PresentationDraft) => void;
  onExportPptx: (draft: PresentationDraft) => void;
}

type PreviewMode = 'slide' | 'markdown';

export function PresentationPage(props: PresentationPageProps) {
  const [draft, setDraft] = useState<PresentationDraft | null>(props.draft);
  const [selectedSlideId, setSelectedSlideId] = useState(getDefaultSlideId(props.draft));
  const [previewMode, setPreviewMode] = useState<PreviewMode>('slide');
  const [isEnhancingOutline, setIsEnhancingOutline] = useState(false);
  const [enhanceError, setEnhanceError] = useState('');
  const [showRawSources, setShowRawSources] = useState(false);

  useEffect(() => {
    setDraft(props.draft);
    setSelectedSlideId(getDefaultSlideId(props.draft));
  }, [props.draft]);

  useEffect(() => {
    setShowRawSources(false);
  }, [selectedSlideId]);

  const selectedSlide = useMemo(
    () => draft?.slides.find((slide) => slide.id === selectedSlideId) ?? draft?.slides[0] ?? null,
    [draft, selectedSlideId]
  );
  const slidePlans = useMemo(() => (draft ? buildPptxSlidePlan(draft) : []), [draft]);
  const reviewReport = useMemo(() => (draft ? buildPresentationReviewReport(draft) : null), [draft]);
  const slidePlanById = useMemo(() => new Map(slidePlans.map((plan) => [plan.id, plan])), [slidePlans]);
  const selectedPlan = selectedSlide
    ? slidePlans.find((plan) => plan.id === selectedSlide.id) ?? slidePlans[0] ?? null
    : null;
  const selectedDisplayTitle = selectedPlan
    ? getSlideDisplayTitle(selectedPlan.type, selectedPlan.title)
    : selectedSlide?.title ?? '';
  const markdownPreview = draft ? serializePresentationMarkdown(draft) : '';
  const previewSourceFooters = selectedPlan?.sourceFooter
    .split(/\s+\|\s+/u)
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
  const selectedPreviewBullets = selectedPlan ? buildPreviewBullets(selectedPlan.mainClaim, selectedPlan.bullets) : [];
  const selectedEditorBullets = selectedPlan?.bullets ?? selectedSlide?.bullets ?? [];
  const showPreviewVisual = selectedPlan ? shouldShowPreviewVisual(selectedPlan.visual) : false;
  const selectedPreviewEvidenceCards = selectedPlan ? buildPreviewEvidenceCards(selectedPlan, selectedPreviewBullets) : [];

  function updateSlide(patch: Partial<PresentationSlide>): void {
    if (!draft || !selectedSlide) {
      return;
    }

    setDraft({
      ...draft,
      slides: draft.slides.map((slide) => (slide.id === selectedSlide.id ? { ...slide, ...patch } : slide))
    });
  }

  function updateBullets(value: string): void {
    updateSlide({
      bullets: value
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/u, '').trim())
        .filter(Boolean)
    });
  }

  async function handleEnhanceOutlineWithAi(): Promise<void> {
    if (!draft || isEnhancingOutline) {
      return;
    }

    setIsEnhancingOutline(true);
    setEnhanceError('');
    try {
      const prompt = buildPresentationAiEnhancementPrompt(draft);
      const aiText = await window.electronAPI.completeWithAi(prompt);
      const nextDraft = applyAiEnhancedPresentationDraft(draft, aiText);
      setDraft(nextDraft);
      setSelectedSlideId(getDefaultSlideId(nextDraft));
    } catch (error) {
      setEnhanceError(`AI outline enhancement failed: ${String(error)}`);
    } finally {
      setIsEnhancingOutline(false);
    }
  }

  if (!draft) {
    return (
      <main className="presentation-page">
        <header className="presentation-header">
          <div>
            <span className="eyebrow">Seminar PPT</span>
            <h1>组会 PPT 生成器</h1>
            <p>请先在 PDF 阅读页打开论文，再基于当前 PDF 生成组会 PPT 草稿。</p>
          </div>
          <div className="page-header-actions">
            <button type="button" className="secondary-button button-with-icon" onClick={props.onOpenReader}>
              <img className="button-icon" src={backIcon} alt="" />
              <span>返回 PDF 阅读</span>
            </button>
            <button type="button" className="primary-button button-with-icon" onClick={props.onRegenerate}>
              <img className="button-icon" src={refreshIcon} alt="" />
              <span>从当前 PDF 生成</span>
            </button>
          </div>
        </header>
        <section className="empty-state presentation-empty">
          <h2>暂无 PPT 草稿</h2>
          <p>第一阶段会从 PDF.js 文本层提取标题、章节、关键段落和 Fig./Table caption，生成可编辑的大纲、HTML 预览和 Markdown。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="presentation-page">
      <header className="presentation-header">
        <div>
          <span className="eyebrow">Seminar PPT</span>
          <h1>{draft.title}</h1>
          <p>{draft.subtitle} · {draft.slides.length} 页 · 图表候选 {draft.figures.length} 个</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={props.onBackHome}>
            <img className="button-icon" src={backIcon} alt="" />
            <span>返回工作台</span>
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={props.onRegenerate}>
            <img className="button-icon" src={refreshIcon} alt="" />
            <span>重新生成</span>
          </button>
          <button
            type="button"
            className="secondary-button button-with-icon"
            disabled={isEnhancingOutline}
            onClick={handleEnhanceOutlineWithAi}
          >
            <img className="button-icon" src={refreshIcon} alt="" />
            <span>{isEnhancingOutline ? 'AI 增强中...' : 'AI 增强大纲'}</span>
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onExportJson(draft)}>
            <img className="button-icon" src={saveIcon} alt="" />
            <span>导出 JSON</span>
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onExportMarkdown(draft)}>
            <img className="button-icon" src={downloadIcon} alt="" />
            <span>导出 Markdown</span>
          </button>
          <button
            type="button"
            className="primary-button button-with-icon"
            title={
              reviewReport && !reviewReport.passed
                ? '质量检查未通过时仍会导出标准化版本；建议后续补充真实图表和来源。'
                : '导出 PPTX'
            }
            onClick={() => props.onExportPptx(draft)}
          >
            <img className="button-icon" src={downloadIcon} alt="" />
            <span>导出 PPTX</span>
          </button>
        </div>
      </header>

      {enhanceError ? <div className="inline-alert">{enhanceError}</div> : null}
      {reviewReport ? (
        <section className={reviewReport.passed ? 'inline-alert presentation-quality-pass' : 'inline-alert presentation-quality-fail'}>
          <strong>{reviewReport.passed ? 'PPT 质量检查通过' : '质量检查未通过，请重新生成或修改当前页'}</strong>
          <span>
            方法可解释：{reviewReport.can_explain_method_from_ppt_only ? '是' : '否'} ·
            阶段输入/输出：{reviewReport.can_identify_stage_inputs && reviewReport.can_identify_stage_outputs ? '完整' : '不足'} ·
            图表匹配：{reviewReport.figure_mismatch ? '需检查' : '正常'}
          </span>
          {!reviewReport.passed && reviewReport.issues.length > 0 ? (
            <ul>
              {reviewReport.issues.slice(0, 5).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="presentation-workbench">
        <aside className="presentation-thumbs" aria-label="幻灯片缩略图">
          {draft.slides.map((slide, index) => {
            const thumbPlan = slidePlanById.get(slide.id);
            const thumbTitle = getSlideDisplayTitle(slide.type, thumbPlan?.title ?? slide.title);
            const thumbSummary = buildThumbnailSummary(slide, thumbPlan);

            return (
              <button
                key={slide.id}
                type="button"
                className={slide.id === selectedSlide?.id ? 'active' : ''}
                onClick={() => setSelectedSlideId(slide.id)}
              >
                <span>{index + 1}</span>
                <strong>{thumbTitle}</strong>
                <small>{slide.section ?? slide.type}</small>
                <em>{thumbSummary}</em>
              </button>
            );
          })}
        </aside>

        <section className="presentation-stage">
          <div className="presentation-preview-tabs" role="group" aria-label="预览模式">
            <button
              type="button"
              className={previewMode === 'slide' ? 'active' : ''}
              onClick={() => setPreviewMode('slide')}
            >
              幻灯片预览
            </button>
            <button
              type="button"
              className={previewMode === 'markdown' ? 'active' : ''}
              onClick={() => setPreviewMode('markdown')}
            >
              Markdown 预览
            </button>
          </div>

          {previewMode === 'slide' && selectedSlide && selectedPlan ? (
            <article className={`ppt-slide-preview ppt-export-preview ppt-slide-${selectedPlan.type} ppt-layout-${selectedPlan.layout}`}>
              <header className="ppt-slide-topline">
                <span className="ppt-slide-kicker">{selectedPlan.section}</span>
                <span className="ppt-slide-confidence">
                  {selectedSlide.confidence === 'ai-enhanced' ? 'AI 增强' : '本地草稿'} · {String(selectedPlan.index + 1).padStart(2, '0')}
                </span>
              </header>
              <h2>{selectedDisplayTitle}</h2>
              {selectedPlan.subtitle ? <p className="ppt-slide-subtitle">{selectedPlan.subtitle}</p> : null}
              <div className="ppt-export-body">
                {selectedPlan.layout === 'cover' ? (
                  <div className="ppt-cover-grid">
                    {selectedPlan.bullets.slice(0, 3).map((bullet, index) => (
                      <span key={`${selectedPlan.id}-cover-${index}`}>{bullet}</span>
                    ))}
                  </div>
                ) : null}

                {selectedPlan.layout !== 'cover' ? (
                  <section className="ppt-export-claim">
                    <span className="ppt-panel-label">核心观点</span>
                    <p>{selectedPlan.mainClaim}</p>
                  </section>
                ) : null}

                {selectedPlan.layout !== 'cover' ? (
                  <section className={`ppt-export-main ${showPreviewVisual ? `ppt-export-${selectedPlan.visual.kind}` : 'ppt-export-none'}`}>
                    {showPreviewVisual ? (
                      <div className="ppt-export-visual">
                        <span className="ppt-panel-label">{getVisualKindLabel(selectedPlan.visual.kind)}</span>
                        <strong>{selectedPlan.visual.title}</strong>
                        <p>{selectedPlan.visual.caption}</p>
                        {selectedPlan.visual.steps.length > 0 ? (
                          <ol>
                            {selectedPlan.visual.steps.slice(0, 4).map((step, index) => (
                              <li key={`${selectedPlan.id}-step-${index}`}>{step}</li>
                            ))}
                          </ol>
                        ) : null}
                        <small>{selectedPlan.visual.sourceLabel}</small>
                      </div>
                    ) : null}
                    {showPreviewVisual ? (
                      <ul className="ppt-export-bullets">
                        {selectedPreviewBullets.map((bullet, index) => (
                          <li key={`${selectedPlan.id}-bullet-${index}`}>{bullet}</li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="ppt-export-bullets ppt-export-evidence-cards">
                        {selectedPreviewEvidenceCards.map((card, index) => (
                          <li className={`ppt-export-evidence-card ppt-export-evidence-${card.tone}`} key={`${selectedPlan.id}-evidence-${index}`}>
                            <span className="ppt-export-card-label">{card.label}</span>
                            <p>{card.text}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}

                {selectedPlan.layout !== 'cover' && previewSourceFooters.length > 0 ? (
                  <section className="ppt-export-source-strip" aria-label="来源摘录">
                    {previewSourceFooters.map((source, index) => (
                      <span key={`${selectedPlan.id}-source-card-${index}`}>{source}</span>
                    ))}
                  </section>
                ) : null}
              </div>
              <footer>
                <span>{selectedPlan.sourceFooter}</span>
              </footer>
            </article>
          ) : (
            <MarkdownDocument text={markdownPreview} className="presentation-markdown-preview" />
          )}
        </section>

        <aside className="presentation-editor" aria-label="当前页编辑">
          {selectedSlide ? (
            <>
              <section className="presentation-card">
                <div className="presentation-card-title-row">
                  <h2>当前页内容</h2>
                  <span className="badge">{selectedSlide.type}</span>
                </div>
                {reviewReport?.failed_slides.some((item) => item.index === (selectedPlan?.index ?? -1)) ? (
                  <p className="subtle">
                    当前页触发质量门，请优先补充真实模块名、输入、处理、输出、来源或匹配图表。
                  </p>
                ) : null}
                <label>
                  标题
                  <input value={selectedDisplayTitle} onChange={(event) => updateSlide({ title: event.target.value })} />
                </label>
                <label>
                  要点
                  <textarea
                    value={selectedEditorBullets.join('\n')}
                    onChange={(event) => updateBullets(event.target.value)}
                  />
                </label>
                <label>
                  讲稿备注
                  <textarea
                    value={selectedSlide.speakerNotes}
                    onChange={(event) => updateSlide({ speakerNotes: event.target.value })}
                  />
                </label>
              </section>

              <section className="presentation-card">
                <div className="presentation-card-title-row">
                  <h2>来源信息</h2>
                  {selectedSlide.sourceRefs.length > 0 ? (
                    <button type="button" className="ghost-button compact-button" onClick={() => setShowRawSources((value) => !value)}>
                      {showRawSources ? '隐藏原文摘录' : '展开原文摘录'}
                    </button>
                  ) : null}
                </div>
                {selectedPlan?.sourceFooter ? <p className="presentation-source-summary">{selectedPlan.sourceFooter}</p> : null}
                {selectedSlide.sourceRefs.length === 0 ? (
                  <p className="subtle">封面或占位页没有直接来源段落。</p>
                ) : showRawSources ? (
                  <div className="presentation-source-list">
                    {selectedSlide.sourceRefs.map((ref, index) => (
                      <article key={`${selectedSlide.id}-source-${index}`}>
                        <strong>p. {ref.pageNumber} · {ref.section}</strong>
                        <p>{ref.text}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="subtle">默认只显示页码和章节，避免编辑区被原文长段挤占；需要核对证据时可展开原文摘录。</p>
                )}
              </section>

              <section className="presentation-card">
                <h2>图表候选</h2>
                {draft.figures.length === 0 ? (
                  <p className="subtle">暂未从 Fig./Table caption 中识别出图表候选。后续可接入页面截图和裁剪。</p>
                ) : (
                  <div className="presentation-figure-list">
                    {draft.figures.map((figure) => (
                      <article key={figure.imageId}>
                        <strong>{buildFigureCardTitle(figure.caption)}</strong>
                        <span>p. {figure.pageNumber} · 建议：{figure.suggestedReason ?? figure.suggestedSlide}</span>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function getDefaultSlideId(draft: PresentationDraft | null): string {
  return draft?.slides.find((slide) => slide.type === 'background')?.id ?? draft?.slides[0]?.id ?? '';
}

function getSlideDisplayTitle(type: PresentationSlide['type'], title: string): string {
  const normalizedTitles: Partial<Record<PresentationSlide['type'], string>> = {
    info: '论文基本信息',
    background: '研究背景',
    relatedWork: 'Related Work / 现有不足',
    method: '方法框架',
    formula: '关键模块或公式',
    experiments: '实验设置',
    results: '主要实验结果',
    innovation: '创新点总结',
    limitations: '局限性与讨论',
    inspiration: '对我课题的启发',
    summary: '总结'
  };

  return normalizedTitles[type] ?? title;
}

function getVisualKindLabel(kind: string): string {
  switch (kind) {
    case 'figure':
      return '原文图表';
    case 'table':
      return '对比表';
    case 'diagram':
      return '结构图';
    case 'quote':
      return '证据摘录';
    default:
      return '辅助视觉';
  }
}

function buildThumbnailSummary(slide: PresentationSlide, plan?: PptxSlidePlan): string {
  const candidates = [
    plan?.mainClaim,
    ...(plan?.bullets ?? []),
    plan?.visual.caption,
    slide.section ? `${getSlideDisplayTitle(slide.type, slide.title)} · ${slide.section}` : undefined
  ];
  const summary = candidates.find(
    (item): item is string => typeof item === 'string' && Boolean(item.trim()) && !isRawManuscriptLike(item)
  );
  return truncatePresentationUiText(summary ?? getFallbackThumbnailSummary(slide.type), 72);
}

function getFallbackThumbnailSummary(type: PresentationSlide['type']): string {
  const fallback: Partial<Record<PresentationSlide['type'], string>> = {
    cover: '封面页：标题、来源和汇报信息',
    info: '论文元信息：标题、作者、年份和来源',
    background: '研究背景：问题来源和研究动机',
    relatedWork: '现有不足：已有路线与本文补位',
    method: '方法框架：输入、模块、输出和训练目标',
    formula: '关键模块：公式、目标函数或核心机制',
    experiments: '实验设置：任务、平台、baseline 和指标',
    results: '实验结果：指标表现与关键结论',
    innovation: '创新点：相对前人工作的差异',
    limitations: '局限性：适用边界和待验证问题',
    inspiration: '课题启发：可复用模块和后续实验',
    summary: '总结页：一句话结论和下一步'
  };
  return fallback[type] ?? '导出预览已按组会逻辑整理';
}

function isRawManuscriptLike(text: string): boolean {
  const normalized = text.trim();
  if (
    /\b(we present|our approach|the idea|in our evaluation|and a bimanual|generated subgoal images|combining all of the context|we now discuss|to understand how|in this paper)\b/iu.test(
      normalized
    )
  ) {
    return true;
  }
  const asciiWords = normalized.match(/[A-Za-z]{3,}/gu) ?? [];
  const chineseChars = normalized.match(/[\u4e00-\u9fff]/gu) ?? [];
  return asciiWords.length >= 9 && chineseChars.length < 4;
}

function truncatePresentationUiText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function buildFigureCardTitle(caption: string): string {
  const match = caption.match(/^(Fig(?:ure)?\.?\s*\d+|Table\s*\d+)[:.\s-]*(.*)$/iu);
  if (!match) {
    return truncatePresentationUiText(caption, 64);
  }
  const [, label, title] = match;
  return `${label.trim()} · ${truncatePresentationUiText(title || '论文图表候选', 52)}`;
}

function normalizePreviewText(text: string): string {
  return text
    .replace(/^本页[^：:]{0,20}[：:]/u, '')
    .replace(/[，。；;:：,.!?！？、\s]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function buildPreviewBullets(mainClaim: string, bullets: string[]): string[] {
  const mainKey = normalizePreviewText(mainClaim);
  const seen = new Set<string>();
  const unique: string[] = [];
  bullets.forEach((bullet) => {
    const key = normalizePreviewText(bullet);
    if (!key || key === mainKey || seen.has(key) || looksLikeTemplateClaimPrefix(bullet)) {
      return;
    }
    seen.add(key);
    unique.push(bullet);
  });
  return unique.slice(0, 5);
}

function buildPreviewEvidenceCards(plan: PptxSlidePlan, bullets: string[]): PptxEvidenceCard[] {
  const baseCards = buildPptxEvidenceCards(plan);
  const seen = new Set<string>();
  const cards: PptxEvidenceCard[] = [];

  const addCard = (card: PptxEvidenceCard): void => {
    const key = normalizePreviewText(card.text);
    if (!key || seen.has(key) || looksLikeTemplateClaimPrefix(card.text)) {
      return;
    }
    seen.add(key);
    cards.push(card);
  };

  bullets.slice(0, 4).forEach((bullet, index) => {
    addCard({ label: `证据 ${index + 1}`, text: bullet, tone: 'evidence' });
  });
  baseCards.filter((card) => card.tone !== 'evidence').forEach(addCard);
  baseCards.forEach(addCard);

  return cards.slice(0, 5);
}

function looksLikeTemplateClaimPrefix(text: string): boolean {
  return /^(本页|鏈〉)[^：:锛?]{0,36}[：:锛?]/u.test(text.trim());
}

function shouldShowPreviewVisual(visual: PptxSlidePlan['visual']): boolean {
  if (visual.kind === 'none' || visual.kind === 'quote') {
    return false;
  }
  if (visual.kind === 'figure' || visual.kind === 'table') {
    return Boolean(visual.figure);
  }
  if (visual.kind === 'diagram') {
    return visual.steps.length >= 4 && !looksLikeGenericPreviewDiagram(visual.steps.join(' '));
  }
  return Boolean(visual.caption || visual.steps.length > 0);
}

function looksLikeGenericPreviewDiagram(text: string): boolean {
  return /论文信息|研究对象|论点|方法线索|汇报目标|problem\s*\/\s*solution|research\s*object|presentation\s*goal/iu.test(text);
}

function getPreviewSemanticKey(text: string): string {
  const lower = normalizePreviewText(text);
  if (/language instruction|language command|语言指令/u.test(lower)) return 'language-instruction';
  if (/subgoal image|subgoal|子目标/u.test(lower)) return 'subgoal';
  if (/episode metadata|metadata|元数据/u.test(lower)) return 'episode-metadata';
  if (/long horizon|long-horizon|长程/u.test(lower)) return 'long-horizon';
  if (/compositional generalization|组合泛化/u.test(lower)) return 'compositional-generalization';
  if (/generalization|泛化/u.test(lower)) return 'generalization';
  if (/π0\.7|pi0\.7/u.test(lower)) return 'pi0.7';
  return '';
}
