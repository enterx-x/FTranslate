import { shouldTranslateItem, type AiModelOption, type AiProviderId } from '../../shared/aiTranslation';
import { getAiQueueStats, getCurrentAiCacheItem, getTranslatableExtractedBlocks } from '../lib/aiMode';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import type { TranslationDocument } from '../lib/translation';
import type { AiBalanceResult, AiSettingsView } from '../types/electron';
import { MathText } from './MathText';

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
  aiBalance: AiBalanceResult | null;
  aiForm: AiFormState;
  modelOptions: AiModelOption[];
  isBusy: boolean;
  onProviderChange: (provider: AiProviderId) => void;
  onAiFormChange: (patch: Partial<AiFormState>) => void;
  onSaveSettings: () => void;
  onTestConnection: () => void;
  onRefreshBalance: () => void;
  onBuildCache: () => void;
  onSaveCache: () => void;
  onTranslateCurrent: (force?: boolean) => void;
  onTranslatePending: () => void;
  onSelectItem: (index: number) => void;
}

export function AiModePanel(props: AiModePanelProps) {
  const jsonDocument = props.document?.kind === 'json' ? props.document : null;
  const queueStats = getAiQueueStats(jsonDocument?.items ?? []);
  const currentItem = getCurrentAiCacheItem(jsonDocument, props.currentIndex);
  const extractedTranslatableCount = getTranslatableExtractedBlocks(props.extractedBlocks).length;

  return (
    <div className="ai-mode-panel">
      {currentItem ? (
        <section className="reader-card compact-card ai-current-detail-card">
          <div className="card-header">当前 AI 段译文</div>
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
        </section>
      ) : null}

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
            {props.aiForm.provider === 'kimi' ? (
              <span className="field-hint">Kimi 使用 https://api.moonshot.cn/v1，控制台网址会自动修正。</span>
            ) : null}
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
                      <span>
                        <MathText text={item.original || '无英文原文'} />
                      </span>
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
