import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  pdfData: Uint8Array | null;
  fileName?: string;
  currentPage: number;
  scale: number;
  onDocumentLoad: (pageCount: number) => void;
  onCurrentPageChange: (pageNumber: number) => void;
  onStatusChange: (message: string) => void;
}

export function PdfViewer(props: PdfViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const currentPageRef = useRef(props.currentPage);
  const pageReportedByScrollRef = useRef<number | null>(null);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [pageNumbers, setPageNumbers] = useState<number[]>([]);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    currentPageRef.current = props.currentPage;
  }, [props.currentPage]);

  useEffect(() => {
    if (!props.pdfData) {
      setDocumentProxy(null);
      setPageNumbers([]);
      pageRefs.current.clear();
      canvasRefs.current.clear();
      return;
    }

    let cancelled = false;
    const loadingTask = pdfjsLib.getDocument({ data: props.pdfData.slice() });

    loadingTask.promise
      .then((pdfDocument) => {
        if (cancelled) {
          void pdfDocument.destroy();
          return;
        }

        setDocumentProxy(pdfDocument);
        setPageNumbers(Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1));
        props.onDocumentLoad(pdfDocument.numPages);
        props.onStatusChange(`PDF 已载入，共 ${pdfDocument.numPages} 页。`);
      })
      .catch((error) => {
        if (!cancelled) {
          props.onStatusChange(`PDF 加载失败：${String(error)}`);
        }
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [props.pdfData]);

  useEffect(() => {
    if (!documentProxy || pageNumbers.length === 0) {
      return;
    }

    const activeDocument = documentProxy;
    let cancelled = false;
    const renderTasks: pdfjsLib.RenderTask[] = [];

    async function renderAllPages() {
      setIsRendering(true);

      try {
        // 第一版连续滚动先顺序渲染所有页面，逻辑简单稳定；超长 PDF 后续可再升级为懒加载。
        for (const pageNumber of pageNumbers) {
          if (cancelled) {
            return;
          }

          const canvas = canvasRefs.current.get(pageNumber);
          if (!canvas) {
            continue;
          }

          const page = await activeDocument.getPage(pageNumber);
          if (cancelled) {
            return;
          }

          const viewport = page.getViewport({ scale: props.scale });
          const context = canvas.getContext('2d');

          if (!context) {
            props.onStatusChange('无法创建 PDF canvas 渲染上下文。');
            return;
          }

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport
          });
          renderTasks.push(renderTask);

          await renderTask.promise;
        }
      } catch (error) {
        if (!cancelled && !String(error).includes('RenderingCancelledException')) {
          props.onStatusChange(`PDF 渲染失败：${String(error)}`);
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    }

    void renderAllPages();

    return () => {
      cancelled = true;
      renderTasks.forEach((renderTask) => {
        try {
          renderTask.cancel();
        } catch {
          // 已完成的渲染任务再次 cancel 可能无事可做，清理阶段忽略即可。
        }
      });
    };
  }, [documentProxy, pageNumbers, props.scale]);

  useEffect(() => {
    if (pageReportedByScrollRef.current === props.currentPage) {
      pageReportedByScrollRef.current = null;
      return;
    }

    const pageElement = pageRefs.current.get(props.currentPage);

    if (!pageElement) {
      return;
    }

    // 页码输入、上一页/下一页、恢复上次阅读进度都会走这里，统一滚动到目标页。
    window.requestAnimationFrame(() => {
      pageElement.scrollIntoView({ block: 'start' });
    });
  }, [props.currentPage, props.scale, pageNumbers]);

  function handleScroll(): void {
    const container = scrollContainerRef.current;
    if (!container || pageNumbers.length === 0) {
      return;
    }

    const readingLine = container.scrollTop + container.clientHeight * 0.28;
    let visiblePage = pageNumbers[0];

    for (const pageNumber of pageNumbers) {
      const pageElement = pageRefs.current.get(pageNumber);
      if (!pageElement) {
        continue;
      }

      if (pageElement.offsetTop <= readingLine) {
        visiblePage = pageNumber;
      } else {
        break;
      }
    }

    if (visiblePage !== currentPageRef.current) {
      currentPageRef.current = visiblePage;
      pageReportedByScrollRef.current = visiblePage;
      props.onCurrentPageChange(visiblePage);
    }
  }

  if (!props.pdfData) {
    return (
      <div className="empty-state">
        <h2>未打开 PDF</h2>
        <p>请点击顶部“打开 PDF”或“新建翻译项目”选择本地英文原文 PDF。</p>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <div className="pane-title">
        <span>{props.fileName}</span>
        {isRendering ? <span className="subtle">正在渲染...</span> : null}
      </div>
      <div className="pdf-canvas-wrap" ref={scrollContainerRef} onScroll={handleScroll}>
        <div className="pdf-pages">
          {pageNumbers.map((pageNumber) => (
            <div
              className="pdf-page"
              data-page-number={pageNumber}
              key={pageNumber}
              ref={(element) => {
                if (element) {
                  pageRefs.current.set(pageNumber, element);
                } else {
                  pageRefs.current.delete(pageNumber);
                }
              }}
            >
              <div className="pdf-page-marker">第 {pageNumber} 页</div>
              <canvas
                ref={(element) => {
                  if (element) {
                    canvasRefs.current.set(pageNumber, element);
                  } else {
                    canvasRefs.current.delete(pageNumber);
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
