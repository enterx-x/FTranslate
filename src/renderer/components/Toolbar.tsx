import { memo } from 'react';
import brandMarkUrl from '../assets/brand-mark.png';
import homeIcon from '../assets/icons/duotone/home.svg';
import translateIcon from '../assets/icons/duotone/translate.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import zoomInIcon from '../assets/icons/duotone/zoom-in.svg';
import zoomOutIcon from '../assets/icons/duotone/zoom-out.svg';
import backIcon from '../assets/icons/duotone/back.svg';
import forwardIcon from '../assets/icons/duotone/forward.svg';
import { usePdfSessionContext } from '../contexts/PdfSessionContext';
import styles from '../styles/components/Toolbar.module.css';

interface ToolbarProps {
  onNewProject: () => void;
  onGoHome: () => void;
  onOpenPdf: () => void;
}

export const Toolbar = memo(function Toolbar(props: ToolbarProps) {
  const {
    currentPage,
    pageCount,
    scale,
    onZoomIn,
    onZoomOut,
    onPreviousPage,
    onNextPage,
    onPageChange
  } = usePdfSessionContext();

  return (
    <header className={styles.toolbar}>
      <div className={`${styles.group} ${styles.groupPrimary}`}>
        <button type="button" className={styles.iconButton} onClick={props.onGoHome} title="主页" aria-label="主页">
          <img className={styles.icon} src={homeIcon} alt="" />
        </button>
        <button type="button" className={styles.button} onClick={props.onNewProject} title="新建 PDF 翻译">
          <img className={styles.icon} src={translateIcon} alt="" />
          <span>新建 PDF 翻译</span>
        </button>
        <button type="button" className={styles.button} onClick={props.onOpenPdf} title="打开 PDF">
          <img className={styles.icon} src={pdfReaderIcon} alt="" />
          <span>打开 PDF</span>
        </button>
      </div>

      <div className={styles.brand} aria-label="PDF Translation Reader" title="PDF Translation Reader">
        <img src={brandMarkUrl} alt="" />
      </div>

      <div className={`${styles.group} ${styles.groupRight}`}>
        <button type="button" className={styles.iconButton} onClick={onZoomOut} title="缩小 PDF" aria-label="缩小 PDF">
          <img className={styles.icon} src={zoomOutIcon} alt="" />
        </button>
        <span className={styles.label}>{Math.round(scale * 100)}%</span>
        <button type="button" className={styles.iconButton} onClick={onZoomIn} title="放大 PDF" aria-label="放大 PDF">
          <img className={styles.icon} src={zoomInIcon} alt="" />
        </button>
        <button type="button" className={styles.iconButton} onClick={onPreviousPage} title="上一页" aria-label="上一页">
          <img className={styles.icon} src={backIcon} alt="" />
        </button>
        <button type="button" className={styles.iconButton} onClick={onNextPage} title="下一页" aria-label="下一页">
          <img className={styles.icon} src={forwardIcon} alt="" />
        </button>
        <label className={styles.pageJump}>
          <span>页码</span>
          <input
            type="number"
            min={1}
            max={pageCount || 1}
            value={currentPage}
            onChange={(event) => onPageChange(Number(event.target.value))}
          />
        </label>
        <span className={styles.label}>/ {pageCount || '-'}</span>
      </div>
    </header>
  );
});
