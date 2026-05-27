import { shouldTranslateItem, type AiProviderId } from '../../shared/aiTranslation';
import { getAiQueueStats, getTranslatableExtractedBlocks } from '../lib/aiMode';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import type { TranslationDocument } from '../lib/translation';
import type { AiSettingsView } from '../types/electron';

export interface AiFormState {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  apiKey: string;
}

interface AiModePanelProps {
  document: TranslationDocument | null;
  extractedBlocks: ExtractedPdfBlock[];
  currentIndex: number;
  aiSettings: AiSettingsView | null;
  aiForm: AiFormState;
  isBusy: boolean;
  onProviderChange: (provider: AiProviderId) => void;
  onAiFormChange: (patch: Partial<AiFormState>) => void;
  onSaveSettings: () => void;
  onBuildCache: () => void;
  onSaveCache: () => void;
  onTranslateCurrent: (force?: boolean) => void;
  onTranslatePending: () => void;
  onSelectItem: (index: number) => void;
}

export function AiModePanel(props: AiModePanelProps) {
  const jsonDocument = props.document?.kind === 'json' ? props.document : null;
  const queueStats = getAiQueueStats(jsonDocument?.items ?? []);
  const extractedTranslatableCount = getTranslatableExtractedBlocks(props.extractedBlocks).length;

  return (
    <div className="ai-mode-panel">
      <details className="reader-card compact-card ai-settings-card" open={!props.aiSettings?.apiKeyConfigured}>
        <summary>
          <span className="card-header">AI 设置</span>
          <span className="subtle">
            {props.aiSettings?.apiKeyConfigured
              ? `${props.aiForm.provider} / ${props.aiForm.model}，API Key 已保存`
              : '展开填写 Provider、Base URL、Model 和 API Key'}
          </span>
        </summary>
        <div className="ai-settings-grid">
          <label>
            <span>Provider</span>
            <select
              value={props.aiForm.provider}
              disabled={props.isBusy}
              onChange={(event) => props.onProviderChange(event.target.value as AiProviderId)}
            >
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="kimi">Kimi</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={props.aiForm.baseURL}
              disabled={props.isBusy}
              onChange={(event) => props.onAiFormChange({ baseURL: event.target.value })}
            />
          </label>
          <label>
            <span>Model</span>
            <input
              value={props.aiForm.model}
              disabled={props.isBusy}
              onChange={(event) => props.onAiFormChange({ model: event.target.value })}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              value={props.aiForm.apiKey}
              disabled={props.isBusy}
              type="password"
              placeholder={props.aiSettings?.apiKeyConfigured ? '已保存，留空则继续使用' : '粘贴 API Key'}
              onChange={(event) => props.onAiFormChange({ apiKey: event.target.value })}
            />
          </label>
        </div>
        <div className="panel-actions">
          <button type="button" disabled={props.isBusy} onClick={props.onSaveSettings}>
            保存 AI 设置
          </button>
          <span className="subtle">
            {props.aiSettings?.apiKeyConfigured ? 'API Key 已加密保存到本机' : '尚未保存 API Key'}
          </span>
        </div>
      </details>

      <section className="reader-card compact-card">
        <div className="card-header">PDF 提取与缓存</div>
        <p className="subtle">
          已从 PDF 文本层提取 {props.extractedBlocks.length} 个块，其中 {extractedTranslatableCount}{' '}
          个自然段可作为 AI 翻译候选。标题、公式、图注和图中标签不会进入批量翻译队列。
        </p>
        <div className="panel-actions">
          <button
            type="button"
            disabled={props.isBusy || props.extractedBlocks.length === 0}
            onClick={props.onBuildCache}
          >
            生成/刷新 JSON 缓存
          </button>
          <button type="button" disabled={props.isBusy || !jsonDocument} onClick={props.onSaveCache}>
            保存 AI JSON
          </button>
        </div>
      </section>

      <section className="reader-card compact-card ai-translation-workbench">
        <div className="card-header">AI 翻译队列</div>
        {jsonDocument ? (
          <>
            <div className="ai-summary">
              <span className="ai-summary-file">当前缓存：{jsonDocument.sourceName ?? '未命名 JSON'}</span>
              <span className="ai-summary-page">
                {props.currentIndex + 1} / {jsonDocument.items.length}
              </span>
              <span className="ai-summary-stats" aria-label="AI 翻译队列统计">
                <span className="ai-summary-stat">
                  正文自然段 <strong>{queueStats.total}</strong>
                </span>
                <span className="ai-summary-stat">
                  已缓存 <strong>{queueStats.cached}</strong>
                </span>
                <span className="ai-summary-stat">
                  待翻译 <strong>{queueStats.pending}</strong>
                </span>
                <span className="ai-summary-stat">
                  跳过 <strong>{queueStats.skipped}</strong>
                </span>
              </span>
            </div>
            <div className="panel-actions">
              <button type="button" disabled={props.isBusy} onClick={() => props.onTranslateCurrent(false)}>
                AI 翻译当前段
              </button>
              <button type="button" disabled={props.isBusy} onClick={() => props.onTranslateCurrent(true)}>
                重新翻译当前段
              </button>
              <button
                type="button"
                disabled={props.isBusy || queueStats.pending === 0}
                onClick={props.onTranslatePending}
              >
                批量翻译未缓存段
              </button>
            </div>
            <div className="ai-item-list">
              {jsonDocument.items.map((item, index) => {
                const isCurrent = index === props.currentIndex;
                const pending = shouldTranslateItem(item);
                return (
                  <button
                    key={item.sourceHash ?? item.id ?? `${item.section}-${index}`}
                    type="button"
                    className={isCurrent ? 'ai-item-row is-current' : 'ai-item-row'}
                    onClick={() => props.onSelectItem(index)}
                  >
                    <span className="ai-item-index">{index + 1}</span>
                    <span className="ai-item-main">
                      <strong>{item.section || 'Untitled'}</strong>
                      <span>{item.original || '无英文原文'}</span>
                    </span>
                    <span className={pending ? 'status-pill pending' : 'status-pill cached'}>
                      {pending ? '待翻译' : item.translation ? '已缓存' : '跳过'}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="subtle">请先打开 PDF，等待文本层提取完成，然后生成 JSON 缓存。</p>
        )}
      </section>
    </div>
  );
}
