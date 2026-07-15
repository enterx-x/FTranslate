import { parsePdfTranslationProgress } from '../../shared/pdfTranslation';

export type PdfTranslationProgressVisualState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'cached'
  | 'failed';

export interface PdfTranslationProgressBarProps {
  message: string;
  isBusy?: boolean;
  state?: PdfTranslationProgressVisualState;
  label?: string;
  percent?: number | null;
  compact?: boolean;
}

export function PdfTranslationProgressBar(props: PdfTranslationProgressBarProps) {
  const parsed = parsePdfTranslationProgress(props.message);
  const state = props.state ?? inferProgressState(parsed.message, Boolean(props.isBusy));
  const completed = state === 'completed' || state === 'cached';
  const percent = clampPercent(props.percent ?? parsed.percent ?? (completed ? 100 : state === 'queued' ? 0 : null));
  const indeterminate = state === 'running' && percent === null;
  const statusText = buildStatusText(state, percent);
  const detailText = parsed.currentPage !== null && parsed.totalPages !== null
    ? `已处理 ${parsed.currentPage} / ${parsed.totalPages} 页`
    : parsed.message;

  return (
    <div
      className={`pdf-translation-progress${props.compact ? ' is-compact' : ''} is-${state}`}
      data-pdf-translation-progress
      aria-live="polite"
    >
      <div className="pdf-translation-progress-heading">
        <span>{props.label ?? buildLabel(state)}</span>
        <strong>{statusText}</strong>
      </div>
      <div
        className={`pdf-translation-progress-track${indeterminate ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label={props.label ?? '中文 PDF 生成进度'}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent !== null ? { 'aria-valuenow': percent } : {})}
      >
        <span style={percent !== null ? { width: `${percent}%` } : undefined} />
      </div>
      {detailText ? <p title={detailText}>{detailText}</p> : null}
    </div>
  );
}

function clampPercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function inferProgressState(message: string, isBusy: boolean): PdfTranslationProgressVisualState {
  if (isBusy) return 'running';
  if (/失败|错误|拦截/u.test(message)) return 'failed';
  if (/已生成|已复用|已完成/u.test(message)) return /复用/u.test(message) ? 'cached' : 'completed';
  return 'idle';
}

function buildLabel(state: PdfTranslationProgressVisualState): string {
  if (state === 'queued') return '等待生成中文 PDF';
  if (state === 'running') return '正在生成中文 PDF';
  if (state === 'completed') return '中文 PDF 已生成';
  if (state === 'cached') return '中文 PDF 已复用缓存';
  if (state === 'failed') return '中文 PDF 生成失败';
  return 'PDF 翻译引擎';
}

function buildStatusText(state: PdfTranslationProgressVisualState, percent: number | null): string {
  if (percent !== null) return `${percent}%`;
  if (state === 'running') return '处理中';
  if (state === 'failed') return '需要处理';
  return '就绪';
}
