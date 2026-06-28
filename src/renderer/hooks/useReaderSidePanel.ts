import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clampPanelRatio, getRightPanelRatioFromPointer } from '../lib/responsiveLayout';

export const READER_SIDE_PANEL_RATIO_KEY = 'pdfTranslationReader:readerSidePanelRatio';
export const DEFAULT_READER_SIDE_PANEL_RATIO = 0.34;
export const READER_SIDE_PANEL_MIN_RATIO = 0.2;
export const READER_SIDE_PANEL_MAX_RATIO = 0.46;

export function clampReaderSidePanelRatio(value: number): number {
  return clampPanelRatio(
    value,
    READER_SIDE_PANEL_MIN_RATIO,
    READER_SIDE_PANEL_MAX_RATIO,
    DEFAULT_READER_SIDE_PANEL_RATIO
  );
}

export function shouldResetReaderSidePanelRatio(
  previousPointerUpAt: number,
  currentPointerUpAt: number,
  didMove: boolean
): boolean {
  return !didMove && currentPointerUpAt - previousPointerUpAt < 320;
}

export function useReaderSidePanel() {
  const [isReaderSidePanelCollapsed, setIsReaderSidePanelCollapsed] = useState(false);
  const [readerSidePanelRatio, setReaderSidePanelRatio] = useState(() =>
    clampReaderSidePanelRatio(Number(localStorage.getItem(READER_SIDE_PANEL_RATIO_KEY)))
  );
  const lastPointerUpAtRef = useRef(0);

  const handleReaderSidePanelResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const handle = event.currentTarget;
    const container = event.currentTarget.closest('.split-layout');
    if (!(container instanceof HTMLElement)) {
      return;
    }

    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('is-resizing-layout');
    const rect = container.getBoundingClientRect();
    const startX = event.clientX;
    let latestRatio = readerSidePanelRatio;
    let didMove = false;

    const move = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientX - startX) > 3) {
        didMove = true;
      }
      const nextRatio = getRightPanelRatioFromPointer(
        {
          clientX: moveEvent.clientX,
          left: rect.left,
          width: rect.width
        },
        READER_SIDE_PANEL_MIN_RATIO,
        READER_SIDE_PANEL_MAX_RATIO,
        DEFAULT_READER_SIDE_PANEL_RATIO
      );
      latestRatio = nextRatio;
      setReaderSidePanelRatio(nextRatio);
    };

    const stop = (stopEvent: PointerEvent) => {
      document.body.classList.remove('is-resizing-layout');
      try {
        handle.releasePointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture may already be released after cancel.
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);

      if (stopEvent.type === 'pointerup' && !didMove) {
        const now = window.performance.now();
        if (shouldResetReaderSidePanelRatio(lastPointerUpAtRef.current, now, didMove)) {
          latestRatio = DEFAULT_READER_SIDE_PANEL_RATIO;
          setReaderSidePanelRatio(DEFAULT_READER_SIDE_PANEL_RATIO);
        }
        lastPointerUpAtRef.current = now;
      } else if (didMove) {
        lastPointerUpAtRef.current = 0;
      }

      localStorage.setItem(READER_SIDE_PANEL_RATIO_KEY, String(latestRatio));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [readerSidePanelRatio]);

  return {
    isReaderSidePanelCollapsed,
    setIsReaderSidePanelCollapsed,
    readerSidePanelRatio,
    setReaderSidePanelRatio,
    handleReaderSidePanelResizeStart
  };
}
