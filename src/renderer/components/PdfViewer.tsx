import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  buildAnchoredScrollPosition,
  getWheelZoomScale,
  type PdfZoomAnchor
} from '../lib/pdfInteraction';
import { buildPdfCanvasDimensions } from '../lib/pdfRenderGeometry';
import { findBestTextItemMatch, type PdfTextItemLike } from '../lib/pdfTextHighlight';
import {
  buildPdfDocumentOutline,
  orderPositionedTextItemsForReading,
  type ExtractedPdfBlock,
  type PositionedPdfTextItem
} from '../lib/pdfTextStructure';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface HighlightTextItem extends PositionedPdfTextItem, PdfTextItemLike {
  textDivIndex: number;
}

interface PdfViewerProps {
  pdfData: Uint8Array | null;
  fileName?: string;
  currentPage: number;
  scale: number;
  highlightText?: string;
  onScaleChange: (nextScale: number, anchor?: PdfZoomAnchor) => void;
  onDocumentLoad: (pageCount: number) => void;
  onCurrentPageChange: (pageNumber: number) => void;
  onExtractedTextReady?: (outline: ExtractedPdfBlock[]) => void;
  onHighlightStatusChange?: (message: string) => void;
  onStatusChange: (message: string) => void;
}

export function PdfViewer(props: PdfViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const surfaceRefs = useRef(new Map<number, HTMLDivElement>());
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const textLayerRefs = useRef(new Map<number, HTMLDivElement>());
  const textDivsByPageRef = useRef(new Map<number, HTMLElement[]>());
  const textItemsByPageRef = useRef(new Map<number, HighlightTextItem[]>());
  const currentPageRef = useRef(props.currentPage);
  const pageReportedByScrollRef = useRef<number | null>(null);
  const pendingZoomAnchorRef = useRef<PdfZoomAnchor | null>(null);
  const isSpacePressedRef = useRef(false);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [pageNumbers, setPageNumbers] = useState<number[]>([]);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    currentPageRef.current = props.currentPage;
  }, [props.currentPage]);

  useEffect(() => {
    if (!props.pdfData) {
      setDocumentProxy(null);
      setPageNumbers([]);
      pageRefs.current.clear();
      surfaceRefs.current.clear();
      canvasRefs.current.clear();
      textLayerRefs.current.clear();
      textDivsByPageRef.current.clear();
      textItemsByPageRef.current.clear();
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
    const textLayers: Array<{ cancel: () => void }> = [];
    const outlinePages: Array<{ page: number; items: PositionedPdfTextItem[] }> = [];

    async function renderAllPages() {
      setIsRendering(true);
      textDivsByPageRef.current.clear();
      textItemsByPageRef.current.clear();

      try {
        // 第一版连续滚动先顺序渲染所有页面，逻辑简单稳定；超长 PDF 后续可再升级为懒加载。
        for (const pageNumber of pageNumbers) {
          if (cancelled) {
            return;
          }

          const canvas = canvasRefs.current.get(pageNumber);
          const pageSurface = surfaceRefs.current.get(pageNumber);
          const textLayerContainer = textLayerRefs.current.get(pageNumber);
          if (!canvas || !pageSurface || !textLayerContainer) {
            continue;
          }

          const page = await activeDocument.getPage(pageNumber);
          if (cancelled) {
            return;
          }

          const viewport = page.getViewport({ scale: props.scale });
          const dimensions = buildPdfCanvasDimensions(
            viewport.width,
            viewport.height,
            window.devicePixelRatio
          );
          const context = canvas.getContext('2d');

          if (!context) {
            props.onStatusChange('无法创建 PDF canvas 渲染上下文。');
            return;
          }

          pageSurface.style.width = `${dimensions.cssWidth}px`;
          pageSurface.style.height = `${dimensions.cssHeight}px`;

          canvas.width = dimensions.canvasWidth;
          canvas.height = dimensions.canvasHeight;
          canvas.style.width = `${dimensions.cssWidth}px`;
          canvas.style.height = `${dimensions.cssHeight}px`;
          context.setTransform(dimensions.outputScale, 0, 0, dimensions.outputScale, 0, 0);

          textLayerContainer.replaceChildren();
          textLayerContainer.style.width = `${dimensions.cssWidth}px`;
          textLayerContainer.style.height = `${dimensions.cssHeight}px`;

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport
          });
          renderTasks.push(renderTask);

          await renderTask.promise;

          const textContent = await page.getTextContent();
          if (cancelled) {
            return;
          }

          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerContainer,
            viewport
          });
          textLayers.push(textLayer);

          await textLayer.render();
          const positionedItems = toPositionedTextItems(textContent.items, viewport, pageNumber);
          textDivsByPageRef.current.set(pageNumber, textLayer.textDivs);
          textItemsByPageRef.current.set(
            pageNumber,
            orderPositionedTextItemsForReading(toHighlightTextItems(textContent.items, viewport, pageNumber))
          );
          outlinePages.push({
            page: pageNumber,
            items: positionedItems
          });
        }
      } catch (error) {
        if (!cancelled && !String(error).includes('RenderingCancelledException')) {
          props.onStatusChange(`PDF 渲染失败：${String(error)}`);
        }
      } finally {
        if (!cancelled) {
          props.onExtractedTextReady?.(buildPdfDocumentOutline(outlinePages));
          setTextLayerVersion((value) => value + 1);
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
      textLayers.forEach((textLayer) => textLayer.cancel());
    };
  }, [documentProxy, pageNumbers, props.scale]);

  useEffect(() => {
    clearPdfHighlights();

    if (!props.highlightText?.trim()) {
      return;
    }

    for (const pageNumber of pageNumbers) {
      const textItems = textItemsByPageRef.current.get(pageNumber) ?? [];
      const textDivs = textDivsByPageRef.current.get(pageNumber) ?? [];
      const match = findBestTextItemMatch(textItems, props.highlightText);
      const matchedIndexes = match.itemIndexes;

      if (matchedIndexes.length === 0) {
        continue;
      }

      matchedIndexes.forEach((itemIndex) => {
        const textDivIndex = textItems[itemIndex]?.textDivIndex;
        if (textDivIndex !== undefined) {
          textDivs[textDivIndex]?.classList.add('pdf-highlight-match');
        }
      });

      const pageElement = pageRefs.current.get(pageNumber);
      pageElement?.scrollIntoView({ block: 'center' });
      const status =
        match.strategy === 'full'
          ? `已在 PDF 第 ${pageNumber} 页完整高亮当前段原文。`
          : `已在 PDF 第 ${pageNumber} 页部分高亮当前段原文，匹配置信度 ${Math.round(
              match.score * 100
            )}%。`;
      props.onHighlightStatusChange?.(status);
      return;
    }

    props.onHighlightStatusChange?.('未在 PDF 中找到足够相似的当前段原文。');
  }, [pageNumbers, props.highlightText, props.onHighlightStatusChange, textLayerVersion]);

  useEffect(() => {
    if (pendingZoomAnchorRef.current) {
      return;
    }

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

  useEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const container = scrollContainerRef.current;

    if (!anchor || !container) {
      return;
    }

    const surface = surfaceRefs.current.get(anchor.pageNumber);
    if (!surface) {
      return;
    }

    window.requestAnimationFrame(() => {
      const position = buildAnchoredScrollPosition({
        pageOffsetTop: surface.offsetTop,
        pageOffsetLeft: surface.offsetLeft,
        pageWidth: surface.offsetWidth,
        pageHeight: surface.offsetHeight,
        ratioX: anchor.ratioX,
        ratioY: anchor.ratioY,
        pointerXInContainer: anchor.pointerXInContainer,
        pointerYInContainer: anchor.pointerYInContainer
      });

      container.scrollLeft = position.scrollLeft;
      container.scrollTop = position.scrollTop;
      pendingZoomAnchorRef.current = null;
    });
  }, [props.scale, textLayerVersion]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.code !== 'Space' || isEditableTarget(event.target)) {
        return;
      }

      isSpacePressedRef.current = true;
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent): void {
      const container = scrollContainerRef.current;
      const panState = panStateRef.current;

      if (!container || !panState) {
        return;
      }

      container.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
      container.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
    }

    function stopPanning(): void {
      panStateRef.current = null;
      setIsPanning(false);
    }

    if (!isPanning) {
      return;
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopPanning);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopPanning);
    };
  }, [isPanning]);

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

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const anchor = buildZoomAnchor(event.clientX, event.clientY);
    pendingZoomAnchorRef.current = anchor;
    props.onScaleChange(getWheelZoomScale(props.scale, event.deltaY), anchor);
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
    const shouldPan = event.button === 1 || (event.button === 0 && isSpacePressedRef.current);

    if (!shouldPan || !scrollContainerRef.current) {
      return;
    }

    event.preventDefault();
    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: scrollContainerRef.current.scrollLeft,
      scrollTop: scrollContainerRef.current.scrollTop
    };
    setIsPanning(true);
  }

  function buildZoomAnchor(clientX: number, clientY: number): PdfZoomAnchor {
    const container = scrollContainerRef.current;
    const containerRect = container?.getBoundingClientRect();
    const pointerXInContainer = containerRect ? clientX - containerRect.left : 0;
    const pointerYInContainer = containerRect ? clientY - containerRect.top : 0;

    for (const pageNumber of pageNumbers) {
      const surface = surfaceRefs.current.get(pageNumber);
      if (!surface) {
        continue;
      }

      const rect = surface.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return {
          pageNumber,
          ratioX: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
          ratioY: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
          pointerXInContainer,
          pointerYInContainer
        };
      }
    }

    return {
      pageNumber: props.currentPage,
      ratioX: 0.5,
      ratioY: 0.5,
      pointerXInContainer,
      pointerYInContainer
    };
  }

  function clearPdfHighlights(): void {
    textDivsByPageRef.current.forEach((textDivs) => {
      textDivs.forEach((textDiv) => textDiv.classList.remove('pdf-highlight-match'));
    });
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
      <div
        className={`pdf-canvas-wrap${isPanning ? ' is-panning' : ''}`}
        ref={scrollContainerRef}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        onMouseDown={handleMouseDown}
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
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
              <div
                className="pdf-page-surface"
                ref={(element) => {
                  if (element) {
                    surfaceRefs.current.set(pageNumber, element);
                  } else {
                    surfaceRefs.current.delete(pageNumber);
                  }
                }}
              >
                <canvas
                  className="pdf-canvas-layer"
                  ref={(element) => {
                    if (element) {
                      canvasRefs.current.set(pageNumber, element);
                    } else {
                      canvasRefs.current.delete(pageNumber);
                    }
                  }}
                />
                <div
                  className="pdf-text-layer textLayer"
                  ref={(element) => {
                    if (element) {
                      textLayerRefs.current.set(pageNumber, element);
                    } else {
                      textLayerRefs.current.delete(pageNumber);
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function toPositionedTextItems(
  items: unknown[],
  viewport: pdfjsLib.PageViewport,
  pageNumber: number
): PositionedPdfTextItem[] {
  return items
    .map((item) => {
      const record = item as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };

      if (!record.str?.trim() || !record.transform || record.transform.length < 6) {
        return null;
      }

      const [x, y] = viewport.convertToViewportPoint(record.transform[4], record.transform[5]);
      return {
        str: record.str,
        x,
        y,
        width: Math.max(1, (record.width ?? 1) * viewport.scale),
        height: Math.max(1, (record.height ?? 1) * viewport.scale),
        page: pageNumber
      };
    })
    .filter((item): item is PositionedPdfTextItem => Boolean(item));
}

function toHighlightTextItems(
  items: unknown[],
  viewport: pdfjsLib.PageViewport,
  pageNumber: number
): HighlightTextItem[] {
  let textDivIndex = 0;

  return items
    .map((item) => {
      const record = item as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };

      if (!record.str?.trim() || !record.transform || record.transform.length < 6) {
        return null;
      }

      const currentTextDivIndex = textDivIndex;
      textDivIndex += 1;
      const [x, y] = viewport.convertToViewportPoint(record.transform[4], record.transform[5]);
      return {
        str: record.str,
        x,
        y,
        width: Math.max(1, (record.width ?? 1) * viewport.scale),
        height: Math.max(1, (record.height ?? 1) * viewport.scale),
        page: pageNumber,
        textDivIndex: currentTextDivIndex
      };
    })
    .filter((item): item is HighlightTextItem => Boolean(item));
}
