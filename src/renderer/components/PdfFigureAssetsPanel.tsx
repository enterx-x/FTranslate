import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  PresentationFigureCandidate,
  PresentationFigureCropBox
} from '../lib/presentationOutline';
import type {
  FigureExtractionProgress,
  PdfFigurePagePreview
} from '../lib/presentationFigureAssets';

export interface PdfFigureAssetsSummary {
  totalCount: number;
  readyCount: number;
  nativeCount: number;
  compositeCount: number;
  cropCount: number;
}

interface PdfFigureAssetsPanelProps {
  figures: PresentationFigureCandidate[];
  isExtracting?: boolean;
  progress?: FigureExtractionProgress | null;
  onOpen?: () => void;
}

interface PdfFigureWorkspaceDialogProps {
  open: boolean;
  figures: PresentationFigureCandidate[];
  isExtracting: boolean;
  progress: FigureExtractionProgress | null;
  onClose: () => void;
  onToggleFigure: (imageId: string, selected: boolean) => void;
  onSetSelection: (imageIds: string[], selected: boolean) => void;
  onNavigateToPage: (pageNumber: number) => void;
  onExtractPending: () => void;
  onRescan: () => void;
  onCancelExtraction: () => void;
  onExportSelected: () => void;
  onGeneratePresentation: () => void;
  onLoadPagePreview: (pageNumber: number) => Promise<PdfFigurePagePreview>;
  onApplyCrop: (
    figure: PresentationFigureCandidate,
    cropBox: PresentationFigureCropBox
  ) => Promise<void>;
}

type FigureFilter = 'all' | 'selected' | 'ready' | 'review' | 'figure' | 'table';

export function summarizePdfFigureAssets(figures: PresentationFigureCandidate[]): PdfFigureAssetsSummary {
  return figures.reduce<PdfFigureAssetsSummary>(
    (summary, figure) => {
      summary.totalCount += 1;
      if (figure.imageDataUrl) summary.readyCount += 1;
      if (figure.imageExtractionMethod === 'native-image') summary.nativeCount += 1;
      if (figure.imageExtractionMethod === 'native-image-composite') summary.compositeCount += 1;
      if (figure.imageExtractionMethod === 'page-crop') summary.cropCount += 1;
      return summary;
    },
    { totalCount: 0, readyCount: 0, nativeCount: 0, compositeCount: 0, cropCount: 0 }
  );
}

export function PdfFigureAssetsPanel({ figures, isExtracting = false, progress, onOpen }: PdfFigureAssetsPanelProps) {
  if (figures.length === 0 && !isExtracting) return null;
  const summary = summarizePdfFigureAssets(figures);
  const status = isExtracting && progress
    ? `正在处理 ${Math.min(progress.processed + 1, progress.total)}/${progress.total} · p.${progress.pageNumber}`
    : `${summary.readyCount}/${summary.totalCount} 可用`;

  return (
    <section className="pdf-figure-assets" aria-label="PDF 图表素材摘要">
      <div>
        <strong>图表素材</strong>
        <span>{status}</span>
      </div>
      <button type="button" className="secondary-button" onClick={onOpen}>
        打开工作台
      </button>
    </section>
  );
}

export function PdfFigureWorkspaceDialog(props: PdfFigureWorkspaceDialogProps) {
  const [filter, setFilter] = useState<FigureFilter>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cropEditor, setCropEditor] = useState<{
    figure: PresentationFigureCandidate;
    preview: PdfFigurePagePreview;
    crop: PresentationFigureCropBox;
  } | null>(null);
  const [isCropLoading, setIsCropLoading] = useState(false);
  const [isCropApplying, setIsCropApplying] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const summary = useMemo(() => summarizePdfFigureAssets(props.figures), [props.figures]);
  const selectedCount = props.figures.filter((figure) => figure.selected !== false).length;
  const filteredFigures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return props.figures.filter((figure) => {
      if (filter === 'selected' && figure.selected === false) return false;
      if (filter === 'ready' && !figure.imageDataUrl) return false;
      if (filter === 'review' && figure.imageDataUrl) return false;
      if (filter === 'figure' && figure.assetType === 'table') return false;
      if (filter === 'table' && figure.assetType !== 'table') return false;
      if (!normalizedQuery) return true;
      return `${figure.figureLabel ?? ''} ${figure.caption} ${figure.pageNumber}`.toLowerCase().includes(normalizedQuery);
    });
  }, [filter, props.figures, query]);
  const activeFigure = props.figures.find((figure) => figure.imageId === activeId) ?? filteredFigures[0] ?? null;
  const isDiscoveringCandidates = props.isExtracting && props.figures.length === 0;
  const hasNoCandidates = !props.isExtracting && props.figures.length === 0;

  useEffect(() => {
    if (!props.open) return;
    dialogRef.current?.focus();
    if (!activeId || !props.figures.some((figure) => figure.imageId === activeId)) {
      setActiveId(props.figures[0]?.imageId ?? null);
    }
  }, [activeId, props.figures, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (cropEditor) setCropEditor(null);
      else props.onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cropEditor, props]);

  if (!props.open) return null;

  async function openCropEditor(figure: PresentationFigureCandidate): Promise<void> {
    if (!figure.cropBox) return;
    setIsCropLoading(true);
    try {
      const preview = await props.onLoadPagePreview(figure.pageNumber);
      setCropEditor({ figure, preview, crop: { ...figure.cropBox } });
    } finally {
      setIsCropLoading(false);
    }
  }

  async function applyCrop(): Promise<void> {
    if (!cropEditor) return;
    setIsCropApplying(true);
    try {
      await props.onApplyCrop(cropEditor.figure, cropEditor.crop);
      setCropEditor(null);
    } finally {
      setIsCropApplying(false);
    }
  }

  const progressText = props.isExtracting
    ? props.progress
      ? `${props.progress.stage === 'rendering-page' ? '渲染页面' : '生成裁剪'} · ${Math.min(props.progress.processed + 1, props.progress.total)}/${props.progress.total} · 第 ${props.progress.pageNumber} 页`
      : '正在扫描论文结构与 Figure / Table 图注'
    : `候选 ${summary.totalCount} · 可用 ${summary.readyCount} · 已选 ${selectedCount}`;

  return (
    <div className="figure-assets-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <div
        ref={dialogRef}
        className="figure-assets-workspace"
        role="dialog"
        aria-modal="true"
        aria-label="PDF 图表素材工作台"
        data-testid="pdf-figure-workspace"
        tabIndex={-1}
      >
        <header className="figure-assets-header">
          <div>
            <strong>PDF 图表素材</strong>
            <span>{progressText}</span>
          </div>
          <div className="figure-assets-header-actions">
            {props.isExtracting ? (
              <button type="button" className="secondary-button" onClick={props.onCancelExtraction}>取消</button>
            ) : (
              <>
                <button type="button" className="secondary-button" onClick={props.onExtractPending}>提取待处理</button>
                <button type="button" className="secondary-button" onClick={props.onRescan}>重新扫描</button>
              </>
            )}
            <button type="button" className="secondary-button" disabled={selectedCount === 0 || summary.readyCount === 0} onClick={props.onExportSelected}>
              导出所选
            </button>
            <button type="button" className="primary-button" disabled={selectedCount === 0} onClick={props.onGeneratePresentation}>
              用所选生成 PPT
            </button>
            <button type="button" className="icon-button" aria-label="关闭图表素材工作台" onClick={props.onClose}>×</button>
          </div>
        </header>

        <div
          className={`figure-assets-progress${props.isExtracting ? (props.progress ? '' : ' indeterminate') : ' idle'}`}
          aria-label={props.isExtracting ? '图表提取进度' : undefined}
          aria-hidden={props.isExtracting ? undefined : true}
        >
          <span
            style={{
              width: props.isExtracting
                ? props.progress
                  ? `${Math.max(4, props.progress.total > 0 ? (props.progress.processed / props.progress.total) * 100 : 0)}%`
                  : '28%'
                : '0%'
            }}
          />
        </div>

        {isDiscoveringCandidates ? (
          <section className="figure-assets-loading" data-testid="pdf-figure-loading" aria-live="polite">
            <div className="figure-assets-loading-visual" aria-hidden="true">
              <div className="figure-assets-loading-document">
                <span />
                <span />
                <span />
                <i />
              </div>
            </div>
            <div className="figure-assets-loading-copy">
              <span className="figure-assets-loading-kicker">论文结构扫描</span>
              <h2>正在识别图注与图表所在页</h2>
              <p>先建立 Figure / Table、页码和正文的对应关系；识别到候选后会立即进入图表工作台。</p>
              <ol className="figure-assets-loading-steps">
                <li className="active"><span>1</span><div><strong>解析文字与版面</strong><small>定位图注、页码和阅读顺序</small></div></li>
                <li><span>2</span><div><strong>识别图表边界</strong><small>区分图像、表格与组合面板</small></div></li>
                <li><span>3</span><div><strong>生成高清素材</strong><small>按原页坐标进行保真裁剪</small></div></li>
              </ol>
              <p className="figure-assets-loading-note">解析期间 PDF 没有被清空；可随时点击右上角“取消”返回阅读。</p>
            </div>
          </section>
        ) : hasNoCandidates ? (
          <section className="figure-assets-no-results" aria-live="polite">
            <div aria-hidden="true">FIG</div>
            <strong>没有识别到可提取的图表候选</strong>
            <p>这篇 PDF 可能没有标准 Figure / Table 图注，或文字层不可读取。你可以重新扫描，PDF 原文不会受影响。</p>
            <button type="button" className="secondary-button" onClick={props.onRescan}>重新扫描</button>
          </section>
        ) : (
        <div className="figure-assets-layout">
          <aside className="figure-assets-filters" aria-label="图表筛选">
            <label>
              搜索图注或页码
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Figure 3 / success rate" />
            </label>
            <nav>
              {([
                ['all', `全部 ${summary.totalCount}`],
                ['selected', `已选 ${selectedCount}`],
                ['ready', `可用 ${summary.readyCount}`],
                ['review', `${props.isExtracting ? '待提取' : '待调整'} ${summary.totalCount - summary.readyCount}`],
                ['figure', '图像'],
                ['table', '表格']
              ] as Array<[FigureFilter, string]>).map(([value, label]) => (
                <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                  {label}
                </button>
              ))}
            </nav>
            <div className="figure-assets-selection-actions">
              <button type="button" onClick={() => props.onSetSelection(filteredFigures.map((figure) => figure.imageId), true)}>全选当前结果</button>
              <button type="button" onClick={() => props.onSetSelection(filteredFigures.map((figure) => figure.imageId), false)}>取消当前结果</button>
            </div>
            <p>页面裁剪优先保留矢量坐标轴、文字和曲线；裁错时可在右侧手动调整。</p>
          </aside>

          <main className="figure-assets-results" aria-label="图表候选">
            {filteredFigures.length === 0 ? (
              <div className="figure-assets-empty">当前筛选没有候选图表。</div>
            ) : (
              <div className="figure-assets-grid">
                {filteredFigures.map((figure) => (
                  <article
                    key={figure.imageId}
                    className={`${activeFigure?.imageId === figure.imageId ? 'active ' : ''}${figure.selected === false ? 'unselected' : ''}`.trim()}
                    data-figure-card
                  >
                    <label className="figure-assets-checkbox">
                      <input
                        type="checkbox"
                        checked={figure.selected !== false}
                        onChange={(event) => props.onToggleFigure(figure.imageId, event.target.checked)}
                      />
                      <span>加入输出</span>
                    </label>
                    <button type="button" className="figure-assets-thumbnail" onClick={() => setActiveId(figure.imageId)}>
                      {figure.imageDataUrl ? <img src={figure.imageDataUrl} alt={figure.caption} /> : <span>等待提取或调整裁剪</span>}
                    </button>
                    <div className="figure-assets-card-meta">
                      <strong>{figure.figureLabel ?? `第 ${figure.pageNumber} 页图表`}</strong>
                      <span>{getFigureStatusLabel(figure, props.isExtracting)}</span>
                    </div>
                    <p>{figure.caption}</p>
                  </article>
                ))}
              </div>
            )}
          </main>

          <aside className="figure-assets-inspector" aria-label="当前图表详情">
            {activeFigure ? (
              <>
                <div className="figure-assets-preview">
                  {activeFigure.imageDataUrl ? <img src={activeFigure.imageDataUrl} alt={activeFigure.caption} /> : <span>该候选尚无可用图像</span>}
                </div>
                <div className="figure-assets-inspector-title">
                  <strong>{activeFigure.figureLabel ?? `第 ${activeFigure.pageNumber} 页候选`}</strong>
                  <span>{activeFigure.assetType === 'table' ? '表格' : getFigureKindLabel(activeFigure.figureKind)}</span>
                </div>
                <p className="figure-assets-caption">{activeFigure.caption}</p>
                <dl>
                  <div><dt>来源页</dt><dd>第 {activeFigure.pageNumber} 页</dd></div>
                  <div><dt>提取方式</dt><dd>{getExtractionMethodLabel(activeFigure)}</dd></div>
                  <div><dt>分辨率</dt><dd>{activeFigure.imagePixelWidth && activeFigure.imagePixelHeight ? `${activeFigure.imagePixelWidth} × ${activeFigure.imagePixelHeight}` : '待生成'}</dd></div>
                  <div><dt>PPT 建议</dt><dd>{activeFigure.suggestedSlide}</dd></div>
                </dl>
                <div className="figure-assets-inspector-actions">
                  <button type="button" className="secondary-button" onClick={() => props.onNavigateToPage(activeFigure.pageNumber)}>定位原页</button>
                  <button type="button" className="secondary-button" disabled={!activeFigure.cropBox || isCropLoading} onClick={() => void openCropEditor(activeFigure)}>
                    {isCropLoading ? '载入页面...' : '调整裁剪'}
                  </button>
                </div>
              </>
            ) : <div className="figure-assets-empty">选择一个图表查看详情。</div>}
          </aside>
        </div>
        )}

        {cropEditor ? (
          <FigureCropEditor
            value={cropEditor}
            disabled={isCropApplying}
            onChange={(crop) => setCropEditor((current) => current ? { ...current, crop } : current)}
            onCancel={() => setCropEditor(null)}
            onApply={() => void applyCrop()}
          />
        ) : null}
      </div>
    </div>
  );
}

function FigureCropEditor({
  value,
  disabled,
  onChange,
  onCancel,
  onApply
}: {
  value: { figure: PresentationFigureCandidate; preview: PdfFigurePagePreview; crop: PresentationFigureCropBox };
  disabled: boolean;
  onChange: (crop: PresentationFigureCropBox) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const crop = value.crop;
  const preview = value.preview;
  const style = {
    left: `${(crop.x / preview.pageWidth) * 100}%`,
    top: `${(crop.y / preview.pageHeight) * 100}%`,
    width: `${(crop.width / preview.pageWidth) * 100}%`,
    height: `${(crop.height / preview.pageHeight) * 100}%`
  };

  function beginPointerChange(event: ReactPointerEvent, mode: 'move' | 'resize'): void {
    event.preventDefault();
    const frame = frameRef.current;
    if (!frame || disabled) return;
    const rect = frame.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = { ...crop };
    const handleMove = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / rect.width) * preview.pageWidth;
      const dy = ((moveEvent.clientY - startY) / rect.height) * preview.pageHeight;
      if (mode === 'move') {
        onChange({
          ...initial,
          x: clampNumber(initial.x + dx, 0, preview.pageWidth - initial.width),
          y: clampNumber(initial.y + dy, 0, preview.pageHeight - initial.height)
        });
      } else {
        onChange({
          ...initial,
          width: clampNumber(initial.width + dx, 24, preview.pageWidth - initial.x),
          height: clampNumber(initial.height + dy, 24, preview.pageHeight - initial.y)
        });
      }
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  return (
    <div className="figure-crop-backdrop" role="dialog" aria-modal="true" aria-label="调整图表裁剪" data-crop-editor>
      <section className="figure-crop-editor">
        <header>
          <div><strong>调整裁剪 · {value.figure.figureLabel ?? `p.${value.figure.pageNumber}`}</strong><span>拖动框移动，拖右下角改变大小</span></div>
          <button type="button" className="icon-button" aria-label="关闭裁剪编辑器" onClick={onCancel}>×</button>
        </header>
        <div ref={frameRef} className="figure-crop-page">
          <img src={preview.dataUrl} alt={`第 ${value.figure.pageNumber} 页裁剪预览`} />
          <div className="figure-crop-selection" style={style} onPointerDown={(event) => beginPointerChange(event, 'move')}>
            <span onPointerDown={(event) => {
              event.stopPropagation();
              beginPointerChange(event, 'resize');
            }} />
          </div>
        </div>
        <footer>
          <span>{Math.round(crop.width)} × {Math.round(crop.height)} PDF pt</span>
          <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" disabled={disabled} onClick={onApply}>{disabled ? '正在生成高清图...' : '应用并重新提取'}</button>
        </footer>
      </section>
    </div>
  );
}

function getFigureStatusLabel(figure: PresentationFigureCandidate, isExtracting = false): string {
  if (!figure.imageDataUrl) return isExtracting ? '等待提取' : '需调整';
  const pixelWidth = figure.imagePixelWidth ?? 0;
  const pixelHeight = figure.imagePixelHeight ?? 0;
  const cropDensity = figure.cropBox
    ? Math.min(pixelWidth / Math.max(1, figure.cropBox.width), pixelHeight / Math.max(1, figure.cropBox.height))
    : 0;
  const isTooSmall = pixelWidth < 300 || pixelHeight < 160;
  const isLowDensity = figure.cropBox ? cropDensity < 1.45 : pixelWidth < 700 || pixelHeight < 260;
  if (isTooSmall || isLowDensity) return '低分辨率';
  if (figure.imageExtractionMethod === 'page-crop') return '完整页面裁剪';
  if (figure.imageExtractionMethod === 'native-image-composite') return '内嵌组合';
  return '内嵌图像';
}

function getExtractionMethodLabel(figure: PresentationFigureCandidate): string {
  if (figure.imageExtractionMethod === 'page-crop') return '完整页面渲染裁剪';
  if (figure.imageExtractionMethod === 'native-image-composite') return 'PDF 内嵌图像组合';
  if (figure.imageExtractionMethod === 'native-image') return 'PDF 内嵌图像';
  return '尚未提取';
}

function getFigureKindLabel(kind: PresentationFigureCandidate['figureKind']): string {
  if (kind === 'method') return '方法图';
  if (kind === 'setup') return '实验设置';
  if (kind === 'result') return '结果图';
  if (kind === 'case') return '案例图';
  if (kind === 'formula') return '公式';
  return '图表';
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
