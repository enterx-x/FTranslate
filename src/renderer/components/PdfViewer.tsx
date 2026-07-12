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
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import { extractPdfBlocksFromDocument } from '../lib/pdfOutlineExtraction';
import { buildHighlightOverlayLines, type HighlightRectLike } from '../lib/pdfHighlightOverlay';
import { buildOfficialFindFragments } from '../lib/pdfFindQuery';
import {
  buildCenteredHorizontalScroll,
  buildPdfScrollPosition,
  buildPdfViewportState,
  type PdfViewportState
} from '../lib/pdfViewportSync';
import {
  buildPdfSelectionPopoverPosition,
  normalizePdfSelectionText,
  resolvePdfSelectionTranslationDirection,
  type PdfSelectionTranslationDirection
} from '../lib/pdfSelectionTranslation';

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
  viewportSyncId?: string;
  viewportState?: PdfViewportState | null;
  onViewportStateChange?: (state: PdfViewportState) => void;
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

interface HighlightSequenceResult {
  totalMatches: number;
  matchedFragments: number;
}

interface PdfSelectionTranslationState {
  sourceText: string;
  translatedText: string;
  direction: PdfSelectionTranslationDirection;
  engine: string;
  message: string;
  status: 'idle' | 'translating' | 'success' | 'error';
  left: number;
  top: number;
}

export function PdfViewer(props: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerShellRef = useRef<HTMLDivElement | null>(null);
  const viewerElementRef = useRef<HTMLDivElement | null>(null);
  const eventBusRef = useRef<PdfEventBusRuntime | null>(null);
  const linkServiceRef = useRef<PdfLinkServiceRuntime | null>(null);
  const findControllerRef = useRef<PdfFindControllerRuntime | null>(null);
  const pdfViewerRef = useRef<PdfViewerRuntime | null>(null);
  const propsRef = useRef(props);
  const currentFindQueryRef = useRef('');
  const activeHighlightRunIdRef = useRef(0);
  const highlightRectStoreRef = useRef<Map<number, HighlightRectLike[]>>(new Map());
  const isHighlightSequenceRunningRef = useRef(false);
  const pendingZoomAnchorRef = useRef<PdfZoomAnchor | null>(null);
  const hasAppliedInitialHorizontalCenterRef = useRef(false);
  const hasAppliedInitialFitWidthRef = useRef(false);
  const pendingInitialCenterFrameRef = useRef<number | null>(null);
  const isSpacePressedRef = useRef(false);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const isApplyingViewportSyncRef = useRef(false);
  const viewportScrollFrameRef = useRef<number | null>(null);
  const selectionTranslationRequestRef = useRef(0);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [findReadyToken, setFindReadyToken] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [selectionTranslation, setSelectionTranslation] = useState<PdfSelectionTranslationState | null>(null);

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

      if (!hasAppliedInitialFitWidthRef.current) {
        hasAppliedInitialFitWidthRef.current = true;
        viewer.currentScaleValue = 'page-width';
        const fittedScale = viewer.currentScale;
        if (Number.isFinite(fittedScale) && Math.abs(fittedScale - propsRef.current.scale) > 0.001) {
          propsRef.current.onScaleChange(fittedScale);
        }
      } else {
        viewer.currentScale = propsRef.current.scale;
      }
      setIsRendering(false);
      window.requestAnimationFrame(() => {
        setFindReadyToken((value) => (value === 0 ? 1 : value));
      });
      scheduleInitialHorizontalCenter(8);
      schedulePendingZoomAnchor();
    }

    function handleTextLayerRendered(): void {
      setFindReadyToken((value) => (value === 0 ? 1 : value));
      scheduleHighlightOverlayPaint();
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
      if (isHighlightSequenceRunningRef.current) {
        return;
      }

      const query = currentFindQueryRef.current;
      const total = event.matchesCount?.total ?? 0;
      if (query && total > 0) {
        propsRef.current.onHighlightStatusChange?.(`PDF.js 官方搜索已高亮当前段原文，共 ${total} 处。`);
        scheduleHighlightOverlayPaint();
      }
    }

    function handleFindControlState(event: FindControlStateEvent): void {
      if (isHighlightSequenceRunningRef.current) {
        return;
      }

      const query = currentFindQueryRef.current;
      if (!query) {
        return;
      }

      const total = event.matchesCount?.total ?? 0;
      if (total > 0) {
        propsRef.current.onHighlightStatusChange?.(`PDF.js 官方搜索已高亮当前段原文，共 ${total} 处。`);
        scheduleHighlightOverlayPaint();
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
    eventBus.on('updatetextlayermatches', scheduleHighlightOverlayPaint);
    eventBus.on('textlayerrendered', handleTextLayerRendered);

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
      eventBus.off('updatetextlayermatches', scheduleHighlightOverlayPaint);
      eventBus.off('textlayerrendered', handleTextLayerRendered);
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
      hasAppliedInitialFitWidthRef.current = false;
      selectionTranslationRequestRef.current += 1;
      setSelectionTranslation(null);
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
    hasAppliedInitialFitWidthRef.current = false;
    selectionTranslationRequestRef.current += 1;
    setSelectionTranslation(null);
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
        findController.setDocument(pdfDocument);
        setDocumentProxy(pdfDocument);
        propsRef.current.onDocumentLoad(pdfDocument.numPages);
        propsRef.current.onStatusChange(`PDF 已加载，共 ${pdfDocument.numPages} 页。`);
        void viewer.onePageRendered?.then(() => {
          if (!cancelled) {
            setFindReadyToken((value) => value + 1);
            scheduleInitialHorizontalCenter(8);
          }
        });
        void extractPdfBlocksFromDocument(pdfDocument, () => cancelled).then((outline) => {
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
      hasAppliedInitialHorizontalCenterRef.current = false;
      hasAppliedInitialFitWidthRef.current = false;
      if (pendingInitialCenterFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingInitialCenterFrameRef.current);
        pendingInitialCenterFrameRef.current = null;
      }
      currentFindQueryRef.current = '';
      activeHighlightRunIdRef.current += 1;
      isHighlightSequenceRunningRef.current = false;
      clearHighlightRectStore();
      clearHighlightOverlay();
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
    scheduleInitialHorizontalCenter(4);
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
    const runId = activeHighlightRunIdRef.current + 1;
    activeHighlightRunIdRef.current = runId;
    isHighlightSequenceRunningRef.current = false;
    clearHighlightRectStore();

    if (!query) {
      eventBus.dispatch('find', buildFindRequest(findController, ''));
      props.onHighlightStatusChange?.('');
      clearHighlightOverlay();
      return;
    }

    props.onHighlightStatusChange?.('正在使用 PDF.js 官方搜索定位当前段原文。');
    clearHighlightOverlay();
    const fragments = buildOfficialFindFragments(query);
    void runHighlightSequence(runId, fragments, eventBus, findController);

    return () => {
      activeHighlightRunIdRef.current += 1;
      isHighlightSequenceRunningRef.current = false;
    };
  }, [documentProxy, findReadyToken, props.highlightText, props.scale]);

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !props.onViewportStateChange) {
      return;
    }

    function emitViewportState(): void {
      viewportScrollFrameRef.current = null;
      if (!container || isApplyingViewportSyncRef.current) {
        return;
      }

      propsRef.current.onViewportStateChange?.(
        buildPdfViewportState(
          {
            scrollTop: container.scrollTop,
            scrollLeft: container.scrollLeft,
            scrollHeight: container.scrollHeight,
            scrollWidth: container.scrollWidth,
            clientHeight: container.clientHeight,
            clientWidth: container.clientWidth
          },
          propsRef.current.viewportSyncId
        )
      );
    }

    function handleScroll(): void {
      if (viewportScrollFrameRef.current !== null) {
        return;
      }

      viewportScrollFrameRef.current = window.requestAnimationFrame(emitViewportState);
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (viewportScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportScrollFrameRef.current);
        viewportScrollFrameRef.current = null;
      }
    };
  }, [props.onViewportStateChange]);

  useEffect(() => {
    const container = containerRef.current;
    const viewportState = props.viewportState;
    if (!container || !viewportState || viewportState.source === props.viewportSyncId) {
      return;
    }

    const position = buildPdfScrollPosition(viewportState, {
      scrollHeight: container.scrollHeight,
      scrollWidth: container.scrollWidth,
      clientHeight: container.clientHeight,
      clientWidth: container.clientWidth
    });

    if (
      Math.abs(container.scrollTop - position.scrollTop) < 2 &&
      Math.abs(container.scrollLeft - position.scrollLeft) < 2
    ) {
      return;
    }

    isApplyingViewportSyncRef.current = true;
    container.scrollTop = position.scrollTop;
    container.scrollLeft = position.scrollLeft;
    window.setTimeout(() => {
      isApplyingViewportSyncRef.current = false;
    }, 80);
  }, [props.viewportState, props.viewportSyncId, props.scale, documentProxy]);

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

  function handleTextSelection(): void {
    if (isPanning) {
      return;
    }
    window.setTimeout(captureTextSelection, 0);
  }

  function captureTextSelection(): void {
    const selection = window.getSelection();
    const viewerElement = viewerElementRef.current;
    const shell = viewerShellRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !viewerElement || !shell) {
      return;
    }

    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    if (!viewerElement.contains(ancestor)) {
      return;
    }
    const ancestorElement = ancestor.nodeType === Node.ELEMENT_NODE
      ? (ancestor as Element)
      : ancestor.parentElement;
    if (!ancestorElement?.closest('.textLayer')) {
      return;
    }

    const rawText = selection.toString();
    const sourceText = normalizePdfSelectionText(rawText);
    if (!sourceText) {
      return;
    }
    const selectionRect = range.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    if (selectionRect.width <= 0 && selectionRect.height <= 0) {
      return;
    }
    const position = buildPdfSelectionPopoverPosition(selectionRect, shellRect, {
      width: 340,
      height: 238
    });

    selectionTranslationRequestRef.current += 1;
    setSelectionTranslation({
      sourceText,
      translatedText: '',
      direction: resolvePdfSelectionTranslationDirection(sourceText),
      engine: '',
      message: rawText.trim().length > sourceText.length ? '已整理 PDF 换行；最多翻译 2000 个字符。' : '',
      status: 'idle',
      ...position
    });
  }

  async function translateSelectedText(): Promise<void> {
    if (!selectionTranslation || selectionTranslation.status === 'translating') {
      return;
    }
    const requestId = selectionTranslationRequestRef.current + 1;
    selectionTranslationRequestRef.current = requestId;
    const { sourceText, direction } = selectionTranslation;
    setSelectionTranslation((current) => current ? {
      ...current,
      status: 'translating',
      message: `正在使用本地离线引擎翻译（${direction.label}）...`
    } : current);

    try {
      const result = await window.electronAPI.translateLocalBatch({
        texts: [sourceText],
        sourceLanguage: direction.sourceLanguage,
        targetLanguage: direction.targetLanguage,
        timeoutMs: 120_000
      });
      if (selectionTranslationRequestRef.current !== requestId) {
        return;
      }
      const translatedText = result.texts[0]?.trim() ?? '';
      if (!translatedText) {
        throw new Error('本地翻译返回空结果。');
      }
      setSelectionTranslation((current) => current ? {
        ...current,
        translatedText,
        engine: result.model ?? result.engine,
        message: `${result.model ?? result.engine} · ${direction.label}`,
        status: 'success'
      } : current);
    } catch (error) {
      if (selectionTranslationRequestRef.current !== requestId) {
        return;
      }
      setSelectionTranslation((current) => current ? {
        ...current,
        message: `翻译失败：${String(error).replace(/^Error:\s*/u, '')}`,
        status: 'error'
      } : current);
    }
  }

  async function copySelectedTranslation(): Promise<void> {
    if (!selectionTranslation?.translatedText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(selectionTranslation.translatedText);
      setSelectionTranslation((current) => current ? { ...current, message: '译文已复制到剪贴板。' } : current);
    } catch (error) {
      setSelectionTranslation((current) => current ? {
        ...current,
        message: `复制失败：${String(error).replace(/^Error:\s*/u, '')}`,
        status: 'error'
      } : current);
    }
  }

  function closeSelectionTranslation(): void {
    selectionTranslationRequestRef.current += 1;
    setSelectionTranslation(null);
    window.getSelection()?.removeAllRanges();
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

  function scheduleInitialHorizontalCenter(remainingAttempts = 1): void {
    if (hasAppliedInitialHorizontalCenterRef.current || pendingInitialCenterFrameRef.current !== null) {
      return;
    }

    pendingInitialCenterFrameRef.current = window.requestAnimationFrame(() => {
      pendingInitialCenterFrameRef.current = window.requestAnimationFrame(() => {
        pendingInitialCenterFrameRef.current = null;
        if (!applyInitialHorizontalCenter() && remainingAttempts > 1) {
          scheduleInitialHorizontalCenter(remainingAttempts - 1);
        }
      });
    });
  }

  function applyInitialHorizontalCenter(): boolean {
    const container = containerRef.current;
    const firstPage = viewerElementRef.current?.querySelector<HTMLElement>('.page') ?? null;
    if (!container || !firstPage || hasAppliedInitialHorizontalCenterRef.current) {
      return false;
    }

    const pageRect = firstPage.getBoundingClientRect();
    if (pageRect.width <= 0 || container.clientWidth <= 0) {
      return false;
    }

    const scrollLeft = buildCenteredHorizontalScroll({
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth
    });
    if (scrollLeft > 0) {
      container.scrollLeft = scrollLeft;
    }
    const pageOverflowsContainer = pageRect.width > container.clientWidth + 2;
    if (!pageOverflowsContainer || scrollLeft > 0) {
      hasAppliedInitialHorizontalCenterRef.current = true;
      return true;
    }

    return false;
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

  async function runHighlightSequence(
    runId: number,
    fragments: string[],
    eventBus: PdfEventBusRuntime,
    findController: PdfFindControllerRuntime
  ): Promise<void> {
    if (fragments.length === 0) {
      return;
    }

    isHighlightSequenceRunningRef.current = true;
    let totalMatches = 0;
    let matchedFragments = 0;

    for (const fragment of fragments) {
      if (activeHighlightRunIdRef.current !== runId) {
        return;
      }

      eventBus.dispatch('find', buildFindRequest(findController, fragment));
      const findMatches = await waitForFindResult(eventBus, runId);
      await waitForAnimationFrames(3);

      if (activeHighlightRunIdRef.current !== runId) {
        return;
      }

      const addedRects = collectCurrentOfficialHighlightRects();
      if (findMatches > 0 || addedRects > 0) {
        matchedFragments += 1;
        totalMatches += Math.max(findMatches, 1);
      }
      repaintStoredHighlightOverlay();
    }

    if (activeHighlightRunIdRef.current !== runId) {
      return;
    }

    isHighlightSequenceRunningRef.current = false;
    if (matchedFragments > 0) {
      propsRef.current.onHighlightStatusChange?.(
        `PDF.js 官方搜索已高亮当前段原文，共 ${matchedFragments} 个片段 / ${totalMatches} 处。`
      );
      return;
    }

    propsRef.current.onHighlightStatusChange?.(
      'PDF.js 官方搜索未找到当前段原文；请缩短 original 字段或检查 PDF 是否包含可复制文本。'
    );
  }

  function waitForFindResult(eventBus: PdfEventBusRuntime, runId: number): Promise<number> {
    return new Promise((resolve) => {
      let bestTotal = 0;
      let finishTimer: number | null = null;
      let timeoutTimer: number | null = null;

      const cleanup = (): void => {
        eventBus.off('updatefindmatchescount', handleMatchesCount);
        eventBus.off('updatefindcontrolstate', handleControlState);
        if (finishTimer !== null) {
          window.clearTimeout(finishTimer);
        }
        if (timeoutTimer !== null) {
          window.clearTimeout(timeoutTimer);
        }
      };

      const finish = (): void => {
        cleanup();
        resolve(bestTotal);
      };

      const scheduleFinish = (delay: number): void => {
        if (finishTimer !== null) {
          window.clearTimeout(finishTimer);
        }
        finishTimer = window.setTimeout(finish, delay);
      };

      function handleMatchesCount(event: FindMatchesCountEvent): void {
        if (activeHighlightRunIdRef.current !== runId) {
          finish();
          return;
        }

        bestTotal = Math.max(bestTotal, event.matchesCount?.total ?? 0);
        if (bestTotal > 0) {
          scheduleFinish(450);
        }
      }

      function handleControlState(event: FindControlStateEvent): void {
        if (activeHighlightRunIdRef.current !== runId) {
          finish();
          return;
        }

        bestTotal = Math.max(bestTotal, event.matchesCount?.total ?? 0);
        if (bestTotal > 0) {
          scheduleFinish(450);
          return;
        }

        if (event.state === FindState.NOT_FOUND) {
          scheduleFinish(650);
        }
      }

      eventBus.on('updatefindmatchescount', handleMatchesCount);
      eventBus.on('updatefindcontrolstate', handleControlState);
      timeoutTimer = window.setTimeout(finish, 3800);
    });
  }

  function waitForAnimationFrames(frameCount: number): Promise<void> {
    return new Promise((resolve) => {
      function step(remainingFrames: number): void {
        if (remainingFrames <= 0) {
          resolve();
          return;
        }

        window.requestAnimationFrame(() => step(remainingFrames - 1));
      }

      step(frameCount);
    });
  }

  function scheduleHighlightOverlayPaint(): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (highlightRectStoreRef.current.size > 0) {
          repaintStoredHighlightOverlay();
          return;
        }

        paintHighlightOverlay();
      });
    });
  }

  function clearHighlightOverlay(): void {
    viewerElementRef.current
      ?.querySelectorAll('.pdf-highlight-overlay-line')
      .forEach((element) => element.remove());
  }

  function clearHighlightRectStore(): void {
    highlightRectStoreRef.current.clear();
  }

  function collectCurrentOfficialHighlightRects(): number {
    let addedCount = 0;

    getPdfPageElements().forEach((pageElement) => {
      const pageNumber = Number(pageElement.dataset.pageNumber);
      if (!Number.isInteger(pageNumber)) {
        return;
      }

      const pageRect = pageElement.getBoundingClientRect();
      const highlightRects = Array.from(pageElement.querySelectorAll<HTMLElement>('.textLayer .highlight')).map<
        HighlightRectLike
      >((highlightElement) => {
        const rect = highlightElement.getBoundingClientRect();
        return {
          left: rect.left - pageRect.left,
          top: rect.top - pageRect.top,
          right: rect.right - pageRect.left,
          bottom: rect.bottom - pageRect.top,
          width: rect.width,
          height: rect.height
        };
      });

      addedCount += addHighlightRectsToStore(pageNumber, highlightRects);
    });

    return addedCount;
  }

  function addHighlightRectsToStore(pageNumber: number, rects: HighlightRectLike[]): number {
    const existingRects = highlightRectStoreRef.current.get(pageNumber) ?? [];
    const existingKeys = new Set(existingRects.map(getHighlightRectKey));
    let addedCount = 0;

    rects.forEach((rect) => {
      const key = getHighlightRectKey(rect);
      if (existingKeys.has(key)) {
        return;
      }

      existingKeys.add(key);
      existingRects.push(rect);
      addedCount += 1;
    });

    highlightRectStoreRef.current.set(pageNumber, existingRects);
    return addedCount;
  }

  function repaintStoredHighlightOverlay(): void {
    clearHighlightOverlay();
    getPdfPageElements().forEach((pageElement) => {
      const pageNumber = Number(pageElement.dataset.pageNumber);
      const storedRects = highlightRectStoreRef.current.get(pageNumber);
      if (!Number.isInteger(pageNumber) || !storedRects?.length) {
        return;
      }

      drawHighlightLines(pageElement, storedRects);
    });
  }

  function paintHighlightOverlay(): void {
    const viewerElement = viewerElementRef.current;
    if (!viewerElement || !currentFindQueryRef.current) {
      clearHighlightOverlay();
      return;
    }

    clearHighlightOverlay();
    getPdfPageElements().forEach((pageElement) => {
      const pageRect = pageElement.getBoundingClientRect();
      const highlightRects = Array.from(pageElement.querySelectorAll<HTMLElement>('.textLayer .highlight')).map<
        HighlightRectLike
      >((highlightElement) => {
        const rect = highlightElement.getBoundingClientRect();
        return {
          left: rect.left - pageRect.left,
          top: rect.top - pageRect.top,
          right: rect.right - pageRect.left,
          bottom: rect.bottom - pageRect.top,
          width: rect.width,
          height: rect.height
        };
      });
      drawHighlightLines(pageElement, highlightRects);
    });
  }

  function drawHighlightLines(pageElement: HTMLElement, highlightRects: HighlightRectLike[]): void {
    const lines = buildHighlightOverlayLines(highlightRects, {
      width: pageElement.clientWidth,
      height: pageElement.clientHeight
    });

    lines.forEach((line) => {
      const element = document.createElement('div');
      element.className = 'pdf-highlight-overlay-line';
      element.style.left = `${line.left}px`;
      element.style.top = `${line.top}px`;
      element.style.width = `${line.width}px`;
      element.style.height = `${line.height}px`;
      pageElement.append(element);
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
      <div className="pdf-viewer-shell" ref={viewerShellRef}>
        <div
          className={`pdf-js-viewer-container${isPanning ? ' is-panning' : ''}`}
          ref={containerRef}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
            }
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleTextSelection}
          onWheel={handleWheel}
        >
          <div className="pdfViewer" ref={viewerElementRef} />
        </div>
        {selectionTranslation ? (
          <aside
            className="pdf-selection-translation"
            style={{ left: selectionTranslation.left, top: selectionTranslation.top }}
            aria-label="选中文字翻译"
            data-testid="pdf-selection-translation"
          >
            <header>
              <div>
                <strong>选中翻译</strong>
                <span>{selectionTranslation.direction.label} · 本地离线</span>
              </div>
              <button type="button" aria-label="关闭选中翻译" onClick={closeSelectionTranslation}>×</button>
            </header>
            <div className="pdf-selection-source" title={selectionTranslation.sourceText}>
              {selectionTranslation.sourceText}
            </div>
            {selectionTranslation.translatedText ? (
              <div className="pdf-selection-result" aria-live="polite">
                {selectionTranslation.translatedText}
              </div>
            ) : null}
            {selectionTranslation.message ? (
              <p className={selectionTranslation.status === 'error' ? 'is-error' : ''} aria-live="polite">
                {selectionTranslation.message}
              </p>
            ) : null}
            <footer>
              <button
                type="button"
                className="secondary-button"
                disabled={selectionTranslation.status === 'translating'}
                onClick={() => void translateSelectedText()}
              >
                {selectionTranslation.status === 'translating'
                  ? '翻译中...'
                  : selectionTranslation.translatedText
                    ? '重新翻译'
                    : '翻译选中内容'}
              </button>
              {selectionTranslation.translatedText ? (
                <button type="button" className="ghost-button" onClick={() => void copySelectedTranslation()}>
                  复制译文
                </button>
              ) : null}
            </footer>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function buildFindRequest(source: PdfFindControllerRuntime, queryText: string): object {
  const query = queryText.trim();
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

function getHighlightRectKey(rect: HighlightRectLike): string {
  return [rect.left, rect.top, rect.right, rect.bottom]
    .map((value) => Math.round(value * 2) / 2)
    .join(':');
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
