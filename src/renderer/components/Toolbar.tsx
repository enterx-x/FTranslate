import brandMarkUrl from '../assets/brand-mark.png';

interface ToolbarProps {
  currentPage: number;
  pageCount: number;
  scale: number;
  onNewProject: () => void;
  onGoHome: () => void;
  onOpenPdf: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageChange: (page: number) => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button type="button" onClick={props.onGoHome}>
          主页
        </button>
        <button type="button" onClick={props.onNewProject}>
          新建 PDF 翻译
        </button>
        <button type="button" onClick={props.onOpenPdf}>
          打开 PDF
        </button>
      </div>

      <div className="toolbar-brand" aria-label="PDF Translation Reader" title="PDF Translation Reader">
        <img src={brandMarkUrl} alt="" />
      </div>

      <div className="toolbar-group toolbar-group-right">
        <button type="button" onClick={props.onZoomOut} title="缩小 PDF">
          -
        </button>
        <span className="toolbar-label">{Math.round(props.scale * 100)}%</span>
        <button type="button" onClick={props.onZoomIn} title="放大 PDF">
          +
        </button>
        <button type="button" onClick={props.onPreviousPage}>
          上一页
        </button>
        <button type="button" onClick={props.onNextPage}>
          下一页
        </button>
        <label className="page-jump">
          <span>页码</span>
          <input
            type="number"
            min={1}
            max={props.pageCount || 1}
            value={props.currentPage}
            onChange={(event) => props.onPageChange(Number(event.target.value))}
          />
        </label>
        <span className="toolbar-label">/ {props.pageCount || '-'}</span>
      </div>
    </header>
  );
}
