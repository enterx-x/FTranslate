import { useEffect, useMemo, useState } from 'react';
import { MarkdownDocument } from './MarkdownDocument';
import {
  serializePresentationMarkdown,
  type PresentationDraft,
  type PresentationSlide
} from '../lib/presentationOutline';
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
}

type PreviewMode = 'slide' | 'markdown';

export function PresentationPage(props: PresentationPageProps) {
  const [draft, setDraft] = useState<PresentationDraft | null>(props.draft);
  const [selectedSlideId, setSelectedSlideId] = useState(getDefaultSlideId(props.draft));
  const [previewMode, setPreviewMode] = useState<PreviewMode>('slide');

  useEffect(() => {
    setDraft(props.draft);
    setSelectedSlideId(getDefaultSlideId(props.draft));
  }, [props.draft]);

  const selectedSlide = useMemo(
    () => draft?.slides.find((slide) => slide.id === selectedSlideId) ?? draft?.slides[0] ?? null,
    [draft, selectedSlideId]
  );
  const markdownPreview = draft ? serializePresentationMarkdown(draft) : '';
  const previewBullets = selectedSlide?.bullets.map(formatSlidePreviewText).filter(Boolean) ?? [];
  const primaryPoint = previewBullets[0] ?? selectedSlide?.subtitle ?? '原文未明确说明。';
  const supportPoints = selectedSlide ? buildPreviewSupportCards(selectedSlide, previewBullets) : [];
  const hiddenBulletCount = selectedSlide ? Math.max(0, selectedSlide.bullets.length - 4) : 0;
  const previewSourceRefs = selectedSlide?.sourceRefs.slice(0, 2) ?? [];
  const previewFigure = selectedSlide?.figures.find((figure) => figure.selected !== false) ?? selectedSlide?.figures[0] ?? null;
  const slideLayout = selectedSlide ? getPreviewLayout(selectedSlide) : 'discussion';

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
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onExportJson(draft)}>
            <img className="button-icon" src={saveIcon} alt="" />
            <span>导出 JSON</span>
          </button>
          <button type="button" className="primary-button button-with-icon" onClick={() => props.onExportMarkdown(draft)}>
            <img className="button-icon" src={downloadIcon} alt="" />
            <span>导出 Markdown</span>
          </button>
        </div>
      </header>

      <section className="presentation-workbench">
        <aside className="presentation-thumbs" aria-label="幻灯片缩略图">
          {draft.slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              className={slide.id === selectedSlide?.id ? 'active' : ''}
              onClick={() => setSelectedSlideId(slide.id)}
            >
              <span>{index + 1}</span>
              <strong>{slide.title}</strong>
              <small>{slide.section ?? slide.type}</small>
              <em>{slide.bullets[0] ?? '封面 / 占位页'}</em>
            </button>
          ))}
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

          {previewMode === 'slide' && selectedSlide ? (
            <article className={`ppt-slide-preview ppt-slide-${selectedSlide.type} ppt-layout-${slideLayout}`}>
              <header className="ppt-slide-topline">
                <span className="ppt-slide-kicker">{selectedSlide.section ?? selectedSlide.type}</span>
                <span className="ppt-slide-confidence">{selectedSlide.confidence === 'ai-enhanced' ? 'AI 增强' : '本地草稿'}</span>
              </header>
              <h2>{selectedSlide.title}</h2>
              {selectedSlide.subtitle ? <p className="ppt-slide-subtitle">{selectedSlide.subtitle}</p> : null}
              <div className="ppt-slide-body">
                {slideLayout === 'cover' ? (
                  <div className="ppt-cover-grid">
                    {previewBullets.slice(0, 3).map((bullet, index) => (
                      <span key={`${selectedSlide.id}-cover-${index}`}>{bullet}</span>
                    ))}
                  </div>
                ) : null}

                {slideLayout !== 'cover' ? (
                  <section className="ppt-main-claim">
                    <span className="ppt-panel-label">核心观点</span>
                    <p>{primaryPoint}</p>
                  </section>
                ) : null}

                {slideLayout === 'evidence' ? (
                  <section className="ppt-evidence-layout">
                    <div className="ppt-evidence-frame">
                      <span className="ppt-panel-label">原文图表候选</span>
                      {previewFigure ? (
                        <>
                          <strong>{previewFigure.imageId}</strong>
                          <p>{previewFigure.caption}</p>
                          <small>p. {previewFigure.pageNumber} · {previewFigure.suggestedReason ?? previewFigure.suggestedSlide}</small>
                        </>
                      ) : (
                        <>
                          <strong>Figure / Table</strong>
                          <p>暂未匹配到适合本页的图表 caption，可在右侧候选区手动挑选。</p>
                          <small>优先使用方法图、实验结果图或关键表格</small>
                        </>
                      )}
                    </div>
                    <div className="ppt-callout-stack">
                      {supportPoints.slice(0, 2).map((bullet, index) => (
                        <article key={`${selectedSlide.id}-support-${index}`}>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <p>{bullet}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {slideLayout === 'discussion' || slideLayout === 'info' ? (
                  <section className="ppt-support-grid">
                    {(supportPoints.length > 0 ? supportPoints : previewBullets.slice(0, 3)).slice(0, 3).map((bullet, index) => (
                      <article key={`${selectedSlide.id}-card-${index}`}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <p>{bullet}</p>
                      </article>
                    ))}
                  </section>
                ) : null}

                {hiddenBulletCount > 0 ? <span className="ppt-more-bullet">+{hiddenBulletCount} 条要点在右侧编辑</span> : null}
                {slideLayout !== 'cover' && previewSourceRefs.length > 0 ? (
                  <section className="ppt-source-cards" aria-label="来源摘录">
                    {previewSourceRefs.map((ref, index) => (
                      <article key={`${selectedSlide.id}-source-card-${index}`}>
                        <strong>p. {ref.pageNumber} · {ref.section}</strong>
                        <p>{formatSlidePreviewText(ref.text)}</p>
                      </article>
                    ))}
                  </section>
                ) : null}
                {slideLayout !== 'cover' && selectedSlide.speakerNotes ? (
                  <section className="ppt-speaker-strip">
                    <span>讲稿提示</span>
                    <p>{formatSlidePreviewText(selectedSlide.speakerNotes)}</p>
                  </section>
                ) : null}
              </div>
              {slideLayout !== 'cover' ? (
                <aside className="ppt-context-rail" aria-label="slide evidence rail">
                  <strong>证据</strong>
                  <span>{selectedSlide.section ?? selectedSlide.type}</span>
                  {previewFigure ? (
                    <p>
                      图表：p. {previewFigure.pageNumber} · {formatSlidePreviewText(previewFigure.caption)}
                    </p>
                  ) : null}
                  {previewSourceRefs.slice(0, 2).map((ref, index) => (
                    <p key={`${selectedSlide.id}-rail-source-${index}`}>
                      p. {ref.pageNumber} · {ref.section}
                    </p>
                  ))}
                </aside>
              ) : null}
              <footer>
                {previewSourceRefs.slice(0, 1).map((ref, index) => (
                  <span key={`${selectedSlide.id}-ref-${index}`}>来源：p. {ref.pageNumber} · {ref.section}</span>
                ))}
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
                  <input value={selectedSlide.title} onChange={(event) => updateSlide({ title: event.target.value })} />
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

function getPreviewLayout(slide: PresentationSlide): 'cover' | 'info' | 'evidence' | 'discussion' {
  if (slide.type === 'cover') {
    return 'cover';
  }
  if (slide.type === 'info') {
    return 'info';
  }
  if (['method', 'formula', 'experiments', 'results'].includes(slide.type)) {
    return 'evidence';
  }
  return 'discussion';
}

function buildPreviewSupportCards(slide: PresentationSlide, bullets: string[]): string[] {
  const cards = bullets.slice(1, 4);

  slide.sourceRefs.forEach((ref) => {
    if (cards.length >= 3) {
      return;
    }

    const text = formatSlidePreviewText(ref.text);
    if (text && !cards.includes(text)) {
      cards.push(text);
    }
  });

  if (cards.length < 3 && slide.speakerNotes) {
    cards.push(formatSlidePreviewText(slide.speakerNotes));
  }

  return cards.slice(0, 3);
}

function formatSlidePreviewText(text: string): string {
  return text
    .replace(/\s*(?:[（(]\s*)?(?:p\.|page)\s*\d+\s*(?:[）)])?\s*$/iu, '')
    .replace(/\s*锛坧\.\s*\d+锛塦\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
