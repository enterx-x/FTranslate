import { useEffect, useMemo, useState } from 'react';
import { MarkdownDocument } from './MarkdownDocument';
import {
  applyAiEnhancedPresentationDraft,
  buildPresentationAiEnhancementPrompt,
  serializePresentationMarkdown,
  type PresentationDraft,
  type PresentationSlide
} from '../lib/presentationOutline';
import { buildPptxSlidePlan } from '../lib/presentationPptx';
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

  useEffect(() => {
    setDraft(props.draft);
    setSelectedSlideId(getDefaultSlideId(props.draft));
  }, [props.draft]);

  const selectedSlide = useMemo(
    () => draft?.slides.find((slide) => slide.id === selectedSlideId) ?? draft?.slides[0] ?? null,
    [draft, selectedSlideId]
  );
  const slidePlans = useMemo(() => (draft ? buildPptxSlidePlan(draft) : []), [draft]);
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
          <button type="button" className="primary-button button-with-icon" onClick={() => props.onExportPptx(draft)}>
            <img className="button-icon" src={downloadIcon} alt="" />
            <span>导出 PPTX</span>
          </button>
        </div>
      </header>

      {enhanceError ? <div className="inline-alert">{enhanceError}</div> : null}

      <section className="presentation-workbench">
        <aside className="presentation-thumbs" aria-label="幻灯片缩略图">
          {draft.slides.map((slide, index) => {
            const thumbPlan = slidePlanById.get(slide.id);
            const thumbTitle = getSlideDisplayTitle(slide.type, thumbPlan?.title ?? slide.title);

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
                <em>{slide.bullets[0] ?? '封面 / 占位页'}</em>
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
                  <section className={`ppt-export-main ppt-export-${selectedPlan.visual.kind}`}>
                    {selectedPlan.visual.kind !== 'none' ? (
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
                    <ul className="ppt-export-bullets">
                      {selectedPlan.bullets.slice(0, 5).map((bullet, index) => (
                        <li key={`${selectedPlan.id}-bullet-${index}`}>{bullet}</li>
                      ))}
                    </ul>
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
                <label>
                  标题
                  <input value={selectedDisplayTitle} onChange={(event) => updateSlide({ title: event.target.value })} />
                </label>
                <label>
                  要点
                  <textarea value={selectedSlide.bullets.join('\n')} onChange={(event) => updateBullets(event.target.value)} />
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
                <h2>来源信息</h2>
                {selectedSlide.sourceRefs.length === 0 ? (
                  <p className="subtle">封面或占位页没有直接来源段落。</p>
                ) : (
                  <div className="presentation-source-list">
                    {selectedSlide.sourceRefs.map((ref, index) => (
                      <article key={`${selectedSlide.id}-source-${index}`}>
                        <strong>p. {ref.pageNumber} · {ref.section}</strong>
                        <p>{ref.text}</p>
                      </article>
                    ))}
                  </div>
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
                        <strong>{figure.caption}</strong>
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
