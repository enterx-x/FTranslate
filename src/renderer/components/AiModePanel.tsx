import {
  AI_REASONING_EFFORT_OPTIONS,
  AI_THINKING_MODE_OPTIONS,
  describeAiRuntimeOptions,
  shouldTranslateItem,
  type AiModelOption,
  type AiProviderId,
  type AiReasoningEffort,
  type AiThinkingMode
} from '../../shared/aiTranslation';
import {
  getAiQueueSections,
  getAiQueueStats,
  getCurrentAiCacheItem,
  getTranslatableExtractedBlocks
} from '../lib/aiMode';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import type { TranslationDocument } from '../lib/translation';
import type { AiBalanceResult, AiSettingsView } from '../types/electron';
import { MathText } from './MathText';

export interface AiFormState {
  provider: AiProviderId;
  baseURL: string;
  model: string;
  thinkingMode?: AiThinkingMode;
  reasoningEffort?: AiReasoningEffort;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  apiKey: string;
}

interface AiModePanelProps {
  document: TranslationDocument | null;
  extractedBlocks: ExtractedPdfBlock[];
  currentIndex: number;
  aiSettings: AiSettingsView | null;
  aiBalance: AiBalanceResult | null;
  aiForm: AiFormState;
  modelOptions: AiModelOption[];
  isBusy: boolean;
  onProviderChange: (provider: AiProviderId) => void;
  onAiFormChange: (patch: Partial<AiFormState>) => void;
  onSaveSettings: () => void;
  onTestConnection: () => void;
  onRefreshBalance: () => void;
  onRefreshModels: () => void;
  onBuildCache: () => void;
  onSaveCache: () => void;
  onTranslateCurrent: (force?: boolean) => void;
  onTranslateItem: (index: number, force?: boolean) => void;
  onTranslatePending: () => void;
  onSelectItem: (index: number) => void;
}

export function AiModePanel(props: AiModePanelProps) {
  const jsonDocument = props.document?.kind === 'json' ? props.document : null;
  const queueStats = getAiQueueStats(jsonDocument?.items ?? []);
  const queueSections = getAiQueueSections(jsonDocument?.items ?? []);
  const currentItem = getCurrentAiCacheItem(jsonDocument, props.currentIndex);
  const extractedTranslatableCount = getTranslatableExtractedBlocks(props.extractedBlocks).length;

  return (
    <div className="ai-mode-panel">
      {jsonDocument ? (
        <div className="ai-command-bar" aria-label="AI 当前段快捷操作">
          <span>
            当前 {props.currentIndex + 1} / {jsonDocument.items.length}
            {currentItem?.section ? ` · ${currentItem.section}` : ''}
          </span>
          <button type="button" disabled={props.isBusy} onClick={() => props.onTranslateCurrent(false)}>
            AI 翻译当前段
          </button>
          <button type="button" disabled={props.isBusy} onClick={() => props.onTranslateCurrent(true)}>
            重新翻译
          </button>
          <button
            type="button"
            disabled={props.isBusy || queueStats.pending === 0}
            onClick={props.onTranslatePending}
          >
            批量翻译未缓存
          </button>
        </div>
      ) : null}

      {currentItem ? (
        <details
          className="reader-card compact-card ai-current-detail-card"
          open
        >
          <summary>
            <span className="card-header">当前 AI 段译文</span>
            <span className="ai-current-summary">
              {currentItem.translation.trim() ? '已缓存译文' : '待翻译'} · {currentItem.section || 'Untitled'}
            </span>
          </summary>
          <div className="ai-current-detail">
            <div className="ai-current-meta">
              <strong>{currentItem.section || 'Untitled'}</strong>
              {currentItem.page ? <span>Page {currentItem.page}</span> : null}
              {currentItem.model ? <span>{currentItem.provider ?? 'AI'} / {currentItem.model}</span> : null}
              {currentItem.translatedAt ? (
                <time dateTime={currentItem.translatedAt}>
                  {new Date(currentItem.translatedAt).toLocaleString()}
                </time>
              ) : null}
            </div>
            <div className="ai-current-block">
              <span>Original</span>
              <p>
                <MathText text={currentItem.original || '无英文原文'} />
              </p>
            </div>
            <div className={currentItem.translation.trim() ? 'ai-current-block translated' : 'ai-current-block empty'}>
              <span>AI Translation</span>
              <p>
                <MathText text={currentItem.translation.trim() || '当前段还没有 AI 译文，点击“AI 翻译当前段”后会显示在这里。'} />
              </p>
            </div>
          </div>
        </details>
      ) : null}

      <details className="reader-card compact-card ai-settings-card">
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
            <span className="field-label-with-help">
              Base URL
              <span
                className="field-help"
                title="Kimi 使用 https://api.moonshot.cn/v1；如果粘贴控制台网址，保存时会自动修正为 API 地址。"
              >
                ?
              </span>
            </span>
            <input
              value={props.aiForm.baseURL}
              disabled={props.isBusy}
              onChange={(event) => props.onAiFormChange({ baseURL: event.target.value })}
            />
          </label>
          <label>
            <span>Model</span>
            {props.aiForm.provider === 'custom' ? (
              <input
                value={props.aiForm.model}
                disabled={props.isBusy}
                onChange={(event) => props.onAiFormChange({ model: event.target.value })}
              />
            ) : (
              <select
                value={props.aiForm.model}
                disabled={props.isBusy}
                onChange={(event) => props.onAiFormChange({ model: event.target.value })}
              >
                {props.modelOptions.some((option) => option.value === props.aiForm.model) ? null : (
                  <option value={props.aiForm.model}>{props.aiForm.model}</option>
                )}
                {props.modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
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
        <details className="ai-advanced-options">
          <summary>API 高级选项</summary>
          <div className="ai-settings-grid">
            <label>
              <span>思考模式</span>
              <select
                value={props.aiForm.thinkingMode ?? 'auto'}
                disabled={props.isBusy}
                onChange={(event) => props.onAiFormChange({ thinkingMode: event.target.value as AiThinkingMode })}
              >
                {AI_THINKING_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>OpenAI 推理强度</span>
              <select
                value={props.aiForm.reasoningEffort ?? 'auto'}
                disabled={props.isBusy}
                onChange={(event) => props.onAiFormChange({ reasoningEffort: event.target.value as AiReasoningEffort })}
              >
                {AI_REASONING_EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Temperature</span>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={props.aiForm.temperature ?? ''}
                disabled={props.isBusy}
                onChange={(event) => props.onAiFormChange({ temperature: readOptionalNumber(event.target.value) })}
              />
            </label>
            <label>
              <span>Top P</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={props.aiForm.topP ?? ''}
                disabled={props.isBusy}
                onChange={(event) => props.onAiFormChange({ topP: readOptionalNumber(event.target.value) })}
              />
            </label>
            <label>
              <span>Max tokens</span>
              <input
                type="number"
                min="1"
                step="256"
                value={props.aiForm.maxTokens ?? ''}
                disabled={props.isBusy}
                onChange={(event) => props.onAiFormChange({ maxTokens: readOptionalNumber(event.target.value) })}
              />
            </label>
            <label>
              <span>超时 / 重试</span>
              <div className="inline-number-pair">
                <input
                  aria-label="超时秒数"
                  type="number"
                  min="10"
                  step="10"
                  value={props.aiForm.timeoutSeconds ?? ''}
                  disabled={props.isBusy}
                  onChange={(event) => props.onAiFormChange({ timeoutSeconds: readOptionalNumber(event.target.value) })}
                />
                <input
                  aria-label="重试次数"
                  type="number"
                  min="0"
                  max="8"
                  value={props.aiForm.maxRetries ?? ''}
                  disabled={props.isBusy}
                  onChange={(event) => props.onAiFormChange({ maxRetries: readOptionalNumber(event.target.value) })}
                />
              </div>
            </label>
          </div>
          <p className="subtle">{describeAiRuntimeOptions(props.aiForm)}</p>
        </details>
        <div className="panel-actions">
          <button type="button" disabled={props.isBusy} onClick={props.onSaveSettings}>
            保存 AI 设置
          </button>
          <button
            type="button"
            disabled={props.isBusy || !props.aiSettings?.apiKeyConfigured}
            onClick={props.onTestConnection}
          >
            测试 AI 连接
          </button>
          <button
            type="button"
            disabled={props.isBusy || !props.aiSettings?.apiKeyConfigured}
            onClick={props.onRefreshBalance}
          >
            刷新余额
          </button>
          <button
            type="button"
            disabled={props.isBusy || !props.aiSettings?.apiKeyConfigured || props.aiForm.provider === 'custom'}
            onClick={props.onRefreshModels}
          >
            刷新模型
          </button>
          <span className="subtle">
            {props.aiSettings?.apiKeyConfigured ? 'API Key 已加密保存到本机' : '尚未保存 API Key'}
          </span>
        </div>
        <div className="ai-balance-line">
          <strong>当前 API 余额</strong>
          <span>
            {props.aiBalance
              ? props.aiBalance.message
              : props.aiSettings?.apiKeyConfigured
                ? '尚未查询'
                : '保存 API Key 后可查询'}
          </span>
          {props.aiBalance?.checkedAt ? (
            <time dateTime={props.aiBalance.checkedAt}>
              {new Date(props.aiBalance.checkedAt).toLocaleString()}
            </time>
          ) : null}
        </div>
      </details>

      <details className="reader-card compact-card ai-cache-card">
        <summary>
          <span className="card-header">PDF 提取与缓存</span>
          <span className="subtle">正文候选 {extractedTranslatableCount} 段</span>
        </summary>
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
      </details>

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
            <div className="ai-section-list">
              {queueSections.map((section) => {
                const containsCurrent = section.items.some(({ index }) => index === props.currentIndex);
                return (
                  <details
                    key={section.id}
                    className="ai-section-group"
                    open={containsCurrent || section.startIndex === 0}
                  >
                    <summary>
                      <span className="ai-section-title">
                        <strong>{section.section}</strong>
                        <small>从第 {section.startIndex + 1} 段开始</small>
                      </span>
                      <span className="ai-section-stats">
                        <span>{section.stats.total} 段</span>
                        <span>已缓存 {section.stats.cached}</span>
                        <span>待翻译 {section.stats.pending}</span>
                      </span>
                    </summary>
                    <div className="ai-item-list">
                      {section.items.map(({ item, index }) => {
                        const isCurrent = index === props.currentIndex;
                        const pending = shouldTranslateItem(item);
                        return (
                          <article
                            key={item.sourceHash ?? item.id ?? `${item.section}-${index}`}
                            className={isCurrent ? 'ai-item-row is-current' : 'ai-item-row'}
                          >
                            <button type="button" className="ai-item-select" onClick={() => props.onSelectItem(index)}>
                              <span className="ai-item-index">{index + 1}</span>
                              <span className="ai-item-main">
                                <strong>
                                  {item.paragraphOrder ? `自然段 ${item.paragraphOrder}` : item.section || 'Untitled'}
                                </strong>
                                <span>
                                  <MathText text={item.original || '无英文原文'} />
                                </span>
                              </span>
                            </button>
                            <span className="ai-item-actions">
                              <span className={pending ? 'status-pill pending' : 'status-pill cached'}>
                                {pending ? '待翻译' : item.translation ? '已缓存' : '跳过'}
                              </span>
                              <button
                                type="button"
                                disabled={props.isBusy || !pending}
                                onClick={() => props.onTranslateItem(index, false)}
                              >
                                翻译
                              </button>
                              <button
                                type="button"
                                disabled={props.isBusy || item.type !== 'paragraph'}
                                onClick={() => props.onTranslateItem(index, true)}
                              >
                                重译
                              </button>
                            </span>
                          </article>
                        );
                      })}
                    </div>
                  </details>
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

function readOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const numberValue = Number(trimmed);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
