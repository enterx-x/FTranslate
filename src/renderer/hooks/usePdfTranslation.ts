import { useCallback, useEffect, useState } from 'react';
import { formatPdfTranslationProgressMessage } from '../../shared/pdfTranslation';
import type { PdfTranslationEngineResult, PdfTranslationProgress } from '../types/electron';

interface PdfTranslationProgressState {
  status: string;
  isBusy: boolean;
}

export function reducePdfTranslationProgress(
  current: PdfTranslationProgressState,
  progress: Pick<PdfTranslationProgress, 'message' | 'status'>
): PdfTranslationProgressState {
  return {
    status: formatPdfTranslationProgressMessage(progress.message),
    isBusy:
      progress.status === 'running'
        ? true
        : progress.status === 'completed' || progress.status === 'failed'
          ? false
          : current.isBusy
  };
}

export function usePdfTranslation() {
  const [pdfTranslationEngine, setPdfTranslationEngine] =
    useState<PdfTranslationEngineResult | null>(null);
  const [pdfTranslationStatus, setPdfTranslationStatus] = useState('');
  const [isPdfTranslationBusy, setIsPdfTranslationBusy] = useState(false);

  const refreshPdfTranslationEngine = useCallback(async () => {
    const engine = await window.electronAPI.checkPdfTranslationEngine();
    setPdfTranslationEngine(engine);
    setPdfTranslationStatus(engine.message);
    return engine;
  }, []);

  useEffect(() => {
    refreshPdfTranslationEngine().catch((error) => {
      setPdfTranslationStatus(`PDF 翻译引擎检查失败：${String(error)}`);
    });
  }, [refreshPdfTranslationEngine]);

  useEffect(() => {
    return window.electronAPI.onPdfTranslationProgress((progress: PdfTranslationProgress) => {
      setPdfTranslationStatus(formatPdfTranslationProgressMessage(progress.message));
      setIsPdfTranslationBusy((current) =>
        reducePdfTranslationProgress({ status: '', isBusy: current }, progress).isBusy
      );
    });
  }, []);

  return {
    pdfTranslationEngine,
    pdfTranslationStatus,
    isPdfTranslationBusy,
    setPdfTranslationStatus,
    setIsPdfTranslationBusy,
    refreshPdfTranslationEngine
  };
}
