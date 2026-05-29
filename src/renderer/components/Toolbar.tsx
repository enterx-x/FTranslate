import brandMarkUrl from '../assets/brand-mark.png';
import homeIcon from '../assets/icons/duotone/home.svg';
import translateIcon from '../assets/icons/duotone/translate.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import zoomInIcon from '../assets/icons/duotone/zoom-in.svg';
import zoomOutIcon from '../assets/icons/duotone/zoom-out.svg';
import backIcon from '../assets/icons/duotone/back.svg';
import forwardIcon from '../assets/icons/duotone/forward.svg';

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
      <div className="toolbar-group toolbar-group-primary">
        <button type="button" className="toolbar-icon-button" onClick={props.onGoHome} title="主页" aria-label="主页">
          <img className="button-icon" src={homeIcon} alt="" />
        </button>
        <button type="button" className="toolbar-button" onClick={props.onNewProject} title="新建 PDF 翻译">
          <img className="button-icon" src={translateIcon} alt="" />
          <span>新建 PDF 翻译</span>
        </button>
        <button type="button" className="toolbar-button" onClick={props.onOpenPdf} title="打开 PDF">
          <img className="button-icon" src={pdfReaderIcon} alt="" />
          <span>打开 PDF</span>
        </button>
      </div>

      <div className="toolbar-brand" aria-label="PDF Translation Reader" title="PDF Translation Reader">
        <img src={brandMarkUrl} alt="" />
      </div>

      <div className="toolbar-group toolbar-group-right">
        <button type="button" className="toolbar-icon-button" onClick={props.onZoomOut} title="缩小 PDF" aria-label="缩小 PDF">
          <img className="button-icon" src={zoomOutIcon} alt="" />
        </button>
        <span className="toolbar-label">{Math.round(props.scale * 100)}%</span>
        <button type="button" className="toolbar-icon-button" onClick={props.onZoomIn} title="放大 PDF" aria-label="放大 PDF">
          <img className="button-icon" src={zoomInIcon} alt="" />
        </button>
        <button type="button" className="toolbar-icon-button" onClick={props.onPreviousPage} title="上一页" aria-label="上一页">
          <img className="button-icon" src={backIcon} alt="" />
        </button>
        <button type="button" className="toolbar-icon-button" onClick={props.onNextPage} title="下一页" aria-label="下一页">
          <img className="button-icon" src={forwardIcon} alt="" />
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
