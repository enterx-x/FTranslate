import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  EventBus,
  FindState,
  PDFFindController,
  PDFLinkService,
  PDFViewer as PdfJsViewer,
  ScrollMode
} from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import {
  buildAnchoredScrollPosition,
  getWheelZoomScale,
  type PdfZoomAnchor
} from '../lib/pdfInteraction';
import {
  buildPdfDocumentOutline,
  type ExtractedPdfBlock,
  type PositionedPdfTextItem
} from '../lib/pdfTextStructure';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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

type PdfViewerRuntime = InstanceType<typeof PdfJsViewer>;
type PdfEventBusRuntime = InstanceType<typeof EventBus>;
type PdfLinkServiceRuntime = InstanceType<typeof PDFLinkService>;
type PdfFindControllerRuntime = InstanceType<typeof PDFFindController>;

interface FindMatchesCountEvent {
  matchesCount?: {
    current?: number;
    total?: number;
  };
}

interface FindControlStateEvent extends FindMatchesCountEvent {
  state?: number;
}

export function PdfViewer(props: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerElementRef = useRef<HTMLDivElement | null>(null);
  const eventBusRef = useRef<PdfEventBusRuntime | null>(null);
  const linkServiceRef = useRef<PdfLinkServiceRuntime | null>(null);
  const findControllerRef = useRef<PdfFindControllerRuntime | null>(null);
  const pdfViewerRef = useRef<PdfViewerRuntime | null>(null);
  const propsRef = useRef(props);
  const currentFindQueryRef = useRef('');
  const pendingZoomAnchorRef = useRef<PdfZoomAnchor | null>(null);
  const isSpacePressedRef = useRef(false);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [findReadyToken, setFindReadyToken] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    const container = containerRef.current;
    const viewerElement = viewerElementRef.current;

    if (!container || !viewerElement || pdfViewerRef.current) {
      return;
    }

    // 使用 PDF.js 官方 web viewer 维护页面、文字层、搜索高亮和缩放坐标。
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({
      eventBus,
      linkService,
      updateMatchesCountOnProgress: true
    });
    const pdfViewer = new PdfJsViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      findController,
      removePageBorders: true,
      textLayerMode: 1,
      maxCanvasPixels: -1,
      maxCanvasDim: -1
    });

    pdfViewer.scrollMode = ScrollMode.VERTICAL;
    linkService.setViewer(pdfViewer);

    function handlePagesInit(): void {
      const viewer = pdfViewerRef.current;
      if (!viewer) {
        return;
      }

      viewer.currentScale = propsRef.current.scale;
      setIsRendering(false);
      schedulePendingZoomAnchor();
    }

    function handlePageChanging(event: { pageNumber?: number }): void {
      const pageNumber = Number(event.pageNumber);
      if (Number.isInteger(pageNumber) && pageNumber > 0) {
        propsRef.current.onCurrentPageChange(pageNumber);
      }
    }

    function handleScaleChanging(event: { scale?: number }): void {
      const nextScale = Number(event.scale);
      if (Number.isFinite(nextScale) && Math.abs(nextScale - propsRef.current.scale) > 0.001) {
        propsRef.current.onScaleChange(nextScale);
      }
    }

    function handleFindMatchesCount(event: FindMatchesCountEvent): void {
      const query = currentFindQueryRef.current;
      const total = event.matchesCount?.total ?? 0;
      if (query && total > 0) {
        propsRef.current.onHighlightStatusChange?.(`PDF.js 官方搜索已高亮当前段原文，共 ${total} 处。`);
      }
    }

    function handleFindControlState(event: FindControlStateEvent): void {
      const query = currentFindQueryRef.current;
      if (!query) {
        return;
      }

      const total = event.matchesCount?.total ?? 0;
      if (total > 0) {
        propsRef.current.onHighlightStatusChange?.(`PDF.js 官方搜索已高亮当前段原文，共 ${total} 处。`);
        return;
      }

      if (event.state === FindState.NOT_FOUND) {
        propsRef.current.onHighlightStatusChange?.(
          'PDF.js 官方搜索未找到当前段原文；请缩短 original 字段或检查 PDF 是否包含可复制文本。'
        );
      }
    }

    eventBus.on('pagesinit', handlePagesInit);
    eventBus.on('pagechanging', handlePageChanging);
    eventBus.on('scalechanging', handleScaleChanging);
    eventBus.on('updatefindmatchescount', handleFindMatchesCount);
    eventBus.on('updatefindcontrolstate', handleFindControlState);

    eventBusRef.current = eventBus;
    linkServiceRef.current = linkService;
    findControllerRef.current = findController;
    pdfViewerRef.current = pdfViewer;

    return () => {
      eventBus.off('pagesinit', handlePagesInit);
      eventBus.off('pagechanging', handlePageChanging);
      eventBus.off('scalechanging', handleScaleChanging);
      eventBus.off('updatefindmatchescount', handleFindMatchesCount);
      eventBus.off('updatefindcontrolstate', handleFindControlState);
      pdfViewer.setDocument(null as unknown as PDFDocumentProxy);
      linkService.setDocument(null);
      findController.setDocument(null as unknown as PDFDocumentProxy);
      pdfViewerRef.current = null;
      eventBusRef.current = null;
      linkServiceRef.current = null;
      findControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!props.pdfData) {
      setDocumentProxy(null);
      setFindReadyToken(0);
      setIsRendering(false);
      props.onExtractedTextReady?.([]);
      pdfViewerRef.current?.setDocument(null as unknown as PDFDocumentProxy);
      linkServiceRef.current?.setDocument(null);
      findControllerRef.current?.setDocument(null as unknown as PDFDocumentProxy);
      return;
    }

    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    const loadingTask = pdfjsLib.getDocument({ data: props.pdfData.slice() });
    setIsRendering(true);
    setDocumentProxy(null);
    setFindReadyToken(0);
    props.onExtractedTextReady?.([]);
    props.onHighlightStatusChange?.('');

    loadingTask.promise
      .then((pdfDocument) => {
        if (cancelled) {
          void pdfDocument.destroy();
          return;
        }

        const viewer = pdfViewerRef.current;
        const linkService = linkServiceRef.current;
        const findController = findControllerRef.current;
        if (!viewer || !linkService || !findController) {
          void pdfDocument.destroy();
          return;
        }

        loadedDocument = pdfDocument;
        linkService.setDocument(pdfDocument, null);
        viewer.setDocument(pdfDocument);
        setDocumentProxy(pdfDocument);
        propsRef.current.onDocumentLoad(pdfDocument.numPages);
        propsRef.current.onStatusChange(`PDF 已加载，共 ${pdfDocument.numPages} 页。`);
        void viewer.onePageRendered?.then(() => {
          if (!cancelled) {
            setFindReadyToken((value) => value + 1);
          }
        });
        void extractPdfOutline(pdfDocument, () => cancelled).then((outline) => {
          if (!cancelled) {
            propsRef.current.onExtractedTextReady?.(outline);
          }
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setIsRendering(false);
          propsRef.current.onStatusChange(`PDF 加载失败：${String(error)}`);
        }
      });

    return () => {
      cancelled = true;
      currentFindQueryRef.current = '';
      if (loadedDocument) {
        pdfViewerRef.current?.setDocument(null as unknown as PDFDocumentProxy);
        linkServiceRef.current?.setDocument(null);
        findControllerRef.current?.setDocument(null as unknown as PDFDocumentProxy);
        void loadedDocument.destroy();
      } else {
        void loadingTask.destroy();
      }
    };
  }, [props.pdfData]);

  useEffect(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer || !documentProxy) {
      return;
    }

    if (Math.abs(viewer.currentScale - props.scale) > 0.001) {
      viewer.currentScale = props.scale;
    }

    schedulePendingZoomAnchor();
  }, [documentProxy, props.scale]);

  useEffect(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer || !documentProxy || props.currentPage < 1 || props.currentPage > viewer.pagesCount) {
      return;
    }

    if (viewer.currentPageNumber !== props.currentPage) {
      viewer.currentPageNumber = props.currentPage;
    }
  }, [documentProxy, props.currentPage]);

  useEffect(() => {
    const eventBus = eventBusRef.current;
    const findController = findControllerRef.current;
    if (!eventBus || !findController || !documentProxy || findReadyToken === 0) {
      return;
    }

    const query = props.highlightText?.trim() ?? '';
    currentFindQueryRef.current = query;

    if (!query) {
      eventBus.dispatch('find', buildFindRequest(findController, ''));
      props.onHighlightStatusChange?.('');
      return;
    }

    props.onHighlightStatusChange?.('正在使用 PDF.js 官方搜索定位当前段原文。');
    eventBus.dispatch('find', buildFindRequest(findController, query));
  }, [documentProxy, findReadyToken, props.highlightText]);

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
      const container = containerRef.current;
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
    const container = containerRef.current;

    if (!shouldPan || !container) {
      return;
    }

    event.preventDefault();
    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop
    };
    setIsPanning(true);
  }

  function buildZoomAnchor(clientX: number, clientY: number): PdfZoomAnchor {
    const container = containerRef.current;
    const containerRect = container?.getBoundingClientRect();
    const pointerXInContainer = containerRect ? clientX - containerRect.left : 0;
    const pointerYInContainer = containerRect ? clientY - containerRect.top : 0;

    for (const pageElement of getPdfPageElements()) {
      const rect = pageElement.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return {
          pageNumber: Number(pageElement.dataset.pageNumber ?? props.currentPage),
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

  function schedulePendingZoomAnchor(): void {
    if (!pendingZoomAnchorRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        applyPendingZoomAnchor();
      });
    });
  }

  function applyPendingZoomAnchor(): void {
    const anchor = pendingZoomAnchorRef.current;
    const container = containerRef.current;
    const pageElement = anchor
      ? viewerElementRef.current?.querySelector<HTMLElement>(`.page[data-page-number="${anchor.pageNumber}"]`)
      : null;

    if (!anchor || !container || !pageElement) {
      return;
    }

    const position = buildAnchoredScrollPosition({
      pageOffsetTop: pageElement.offsetTop,
      pageOffsetLeft: pageElement.offsetLeft,
      pageWidth: pageElement.offsetWidth,
      pageHeight: pageElement.offsetHeight,
      ratioX: anchor.ratioX,
      ratioY: anchor.ratioY,
      pointerXInContainer: anchor.pointerXInContainer,
      pointerYInContainer: anchor.pointerYInContainer
    });

    container.scrollLeft = position.scrollLeft;
    container.scrollTop = position.scrollTop;
    pendingZoomAnchorRef.current = null;
  }

  function getPdfPageElements(): HTMLElement[] {
    return Array.from(viewerElementRef.current?.querySelectorAll<HTMLElement>('.page') ?? []);
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
      <div className="pdf-viewer-shell">
        <div
          className={`pdf-js-viewer-container${isPanning ? ' is-panning' : ''}`}
          ref={containerRef}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
            }
          }}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        >
          <div className="pdfViewer" ref={viewerElementRef} />
        </div>
      </div>
    </div>
  );
}

function buildFindRequest(source: PdfFindControllerRuntime, queryText: string): object {
  const query = buildOfficialFindQuery(queryText);
  return {
    source,
    type: '',
    query,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: Boolean(query),
    findPrevious: false,
    matchDiacritics: false
  };
}

function buildOfficialFindQuery(queryText: string): string | string[] {
  const trimmed = queryText.trim();
  if (!trimmed) {
    return '';
  }

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 32);

  // PDF.js 原生 find 支持 string[]，会按多个候选片段搜索并使用官方 textLayer 坐标高亮。
  // 这里把长段落拆成句子，避免整段因换行断词或一个字符差异而完全不命中。
  if (sentences.length >= 2) {
    return sentences.slice(0, 4);
  }

  if (trimmed.length > 320) {
    return trimmed.slice(0, 320);
  }

  return trimmed;
}

async function extractPdfOutline(
  pdfDocument: PDFDocumentProxy,
  isCancelled: () => boolean
): Promise<ExtractedPdfBlock[]> {
  const outlinePages: Array<{ page: number; items: PositionedPdfTextItem[] }> = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (isCancelled()) {
      return [];
    }

    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    outlinePages.push({
      page: pageNumber,
      items: toPositionedTextItems(textContent.items, viewport, pageNumber)
    });
  }

  return buildPdfDocumentOutline(outlinePages);
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
        width: Math.max(1, record.width ?? 1),
        height: Math.max(1, record.height ?? 1),
        page: pageNumber
      };
    })
    .filter((item): item is PositionedPdfTextItem => Boolean(item));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
