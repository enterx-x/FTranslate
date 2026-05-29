import { useEffect, useMemo, useState } from 'react';
import {
  AI_REASONING_EFFORT_OPTIONS,
  AI_THINKING_MODE_OPTIONS,
  describeAiRuntimeOptions,
  type AiModelOption,
  type AiProviderId,
  type AiReasoningEffort,
  type AiThinkingMode
} from '../../shared/aiTranslation';
import type { AiFormState } from './AiModePanel';
import { InsightMarkdown } from './InsightMarkdown';
import {
  LITERATURE_INSIGHT_HISTORY_KEY,
  LITERATURE_INSIGHT_STATE_KEY,
  appendLiteratureInsightHistory,
  completeLiteratureInsightRun,
  createLiteratureInsightRunState,
  failLiteratureInsightRun,
  normalizeLiteratureInsightHistory,
  normalizeLiteratureInsightRunState,
  updateLiteratureInsightRunProgress,
  type LiteratureGapPaperInput,
  type LiteratureInsightHistoryEntry,
  type LiteratureInsightRunState
} from '../lib/literatureInsight';
import {
  getResearchRowValues,
  type ResearchSheetLink,
  type ResearchWorkbook
} from '../lib/researchWorkbook';
import type { PaperRecord } from '../lib/papers';
import type { AiBalanceResult, AiSettingsView } from '../types/electron';
import type { AnalyzeLiteratureGapRequest, AnalyzeLiteratureGapResult } from './ResearchSheetPage';
import aiFillIcon from '../assets/icons/duotone/ai-fill.svg';
import analysisIcon from '../assets/icons/duotone/analysis.svg';
import refreshIcon from '../assets/icons/duotone/refresh.svg';
import saveIcon from '../assets/icons/duotone/save.svg';
import settingsIcon from '../assets/icons/duotone/settings.svg';

type AiAssistantFocus = 'analysis' | 'settings';
type AnalysisTarget = 'currentTable' | 'currentPaper' | 'linkedPapers' | 'allPapers';
type AnalysisType =
  | 'domainOverview'
  | 'methodCompare'
  | 'limitation'
  | 'innovation'
  | 'reproduce'
  | 'idea';

interface AiAssistantPageProps {
  papers: PaperRecord[];
  workbook: ResearchWorkbook;
  links: ResearchSheetLink[];
  activePaperId: string | null;
  focus: AiAssistantFocus;
  aiSettings: AiSettingsView | null;
  aiBalance: AiBalanceResult | null;
  aiForm: AiFormState;
  modelOptions: AiModelOption[];
  isBusy: boolean;
  onOpenResearchSheet: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onProviderChange: (provider: AiProviderId) => void;
  onAiFormChange: (patch: Partial<AiFormState>) => void;
  onSaveSettings: () => void;
  onTestConnection: () => void;
  onRefreshBalance: () => void;
  onRefreshModels: () => void;
  onAnalyzeLiteratureGap: (request: AnalyzeLiteratureGapRequest) => Promise<AnalyzeLiteratureGapResult>;
}

const DEFAULT_ANALYSIS_PROMPT = [
  '请对当前研究领域进行全面的大观分析，内容包括但不限于：',
  '1. 领域发展历程与关键里程碑',
  '2. 主要研究方向与技术脉络',
  '3. 典型方法与代表性工作',
  '4. 当前挑战与局限性',
  '5. 未来趋势与潜在研究方向',
  '',
  '请结合最新文献与公开资料（如开启联网查新），给出结构化、深入的分析结果。'
].join('\n');

const promptTemplates: Array<{ key: string; label: string; content: string }> = [
  { key: 'default', label: '默认模板', content: DEFAULT_ANALYSIS_PROMPT },
  {
    key: 'deep',
    label: '深度分析',
    content:
      '请做一次深度领域分析：先总结共同问题，再归纳方法谱系，最后指出真正长期未解决的科学问题。避免堆模块、换名词或蹭热点。'
  },
  {
    key: 'novelty',
    label: '查新分析',
    content:
      '请优先判断这些论文背后的 idea 是否已经被公开工作覆盖；如果无法联网，请明确标注未实时查新，并只基于输入文献做保守结论。'
  },
  {
    key: 'topic',
    label: '课题相关性',
    content:
      '请围绕我的研究方向：RL、PINNs、路径规划、安全约束、CBF、MPC 和机器人导航，分析这些论文与可做课题的关系。'
  },
  {
    key: 'idea',
    label: '专利/idea 分析',
    content:
      '请基于真实缺口提出 1 个可验证 idea，必须回答明确科学问题、技术路线、实验方案、失败诊断和与已有工作的差异。'
  }
];

const analysisTypeLabels: Record<AnalysisType, string> = {
  domainOverview: '领域大观分析',
  methodCompare: '方法对比',
  limitation: '局限性分析',
  innovation: '创新点提炼',
  reproduce: '复现计划',
  idea: '研究 idea 生成'
};

export function AiAssistantPage(props: AiAssistantPageProps) {
  const [analysisTarget, setAnalysisTarget] = useState<AnalysisTarget>('currentTable');
  const [analysisType, setAnalysisType] = useState<AnalysisType>('domainOverview');
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [searchRange, setSearchRange] = useState('最近 6 个月');
  const [keywords, setKeywords] = useState('');
  const [analysisPrompt, setAnalysisPrompt] = useState(DEFAULT_ANALYSIS_PROMPT);
  const [analysisResult, setAnalysisResult] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [analysisHistory, setAnalysisHistory] = useState<LiteratureInsightHistoryEntry[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(props.focus === 'settings');

  const linkedInputs = useMemo(
    () => buildLinkedLiteratureInputs(props.workbook, props.links, props.papers),
    [props.links, props.papers, props.workbook]
  );
  const activePaper = props.papers.find((paper) => paper.id === props.activePaperId) ?? props.papers[0] ?? null;
  const targetInputs = useMemo(
    () => resolveAnalysisInputs(analysisTarget, props.papers, linkedInputs, activePaper),
    [activePaper, analysisTarget, linkedInputs, props.papers]
  );

  useEffect(() => {
    const restoredState = normalizeLiteratureInsightRunState(
      readJsonFromLocalStorage(LITERATURE_INSIGHT_STATE_KEY)
    );
    if (restoredState) {
      setAnalysisResult(restoredState.result ?? '');
      setAnalysisProgress(restoredState.progress || restoredState.error || '');
      setIsRunning(restoredState.status === 'running');
    }

    const restoredHistory = normalizeLiteratureInsightHistory(
      readJsonFromLocalStorage(LITERATURE_INSIGHT_HISTORY_KEY)
    );
    setAnalysisHistory(restoredHistory);
    setSelectedHistoryId(restoredHistory[0]?.id ?? '');
  }, []);

  function persistRunState(state: LiteratureInsightRunState | null): void {
    if (!state) {
      localStorage.removeItem(LITERATURE_INSIGHT_STATE_KEY);
      return;
    }
    localStorage.setItem(LITERATURE_INSIGHT_STATE_KEY, JSON.stringify(state));
  }

  function persistHistory(next: LiteratureInsightHistoryEntry[]): void {
    setAnalysisHistory(next);
    setSelectedHistoryId(next[0]?.id ?? '');
    localStorage.setItem(LITERATURE_INSIGHT_HISTORY_KEY, JSON.stringify(next));
  }

  async function handleStartAnalysis(): Promise<void> {
    if (targetInputs.length === 0 || props.isBusy || isRunning) {
      return;
    }

    const startedAt = Date.now();
    let runState = createLiteratureInsightRunState(targetInputs.length, startedAt);
    runState = updateLiteratureInsightRunProgress(
      runState,
      `正在准备 ${targetInputs.length} 篇论文上下文，并按“${analysisTypeLabels[analysisType]}”生成分析请求...`,
      Date.now()
    );
    persistRunState(runState);
    setIsRunning(true);
    setAnalysisResult('');
    setAnalysisProgress(runState.progress);

    try {
      const result = await props.onAnalyzeLiteratureGap({
        papers: targetInputs,
        customPrompt: buildCustomPrompt({
          analysisType,
          webSearchEnabled,
          searchRange,
          keywords,
          analysisPrompt
        })
      });
      const text = result.text.trim();

      if (!text) {
        runState = failLiteratureInsightRun(runState, 'AI 没有返回分析结果，请检查 API 设置或论文上下文。', Date.now());
        persistRunState(runState);
        setAnalysisProgress(runState.progress);
        return;
      }

      runState = completeLiteratureInsightRun(runState, text, Date.now());
      persistRunState(runState);
      setAnalysisResult(text);
      setAnalysisProgress('');
      const nextHistory = appendLiteratureInsightHistory(analysisHistory, {
        title: analysisTypeLabels[analysisType],
        paperCount: targetInputs.length,
        provider: result.provider,
        model: result.model,
        createdAt: Date.now(),
        result: text,
        webSearchUsed: webSearchEnabled || Boolean(result.webSearchUsed)
      });
      persistHistory(nextHistory);
    } catch (error) {
      runState = failLiteratureInsightRun(runState, `AI 大观分析失败：${String(error)}`, Date.now());
      persistRunState(runState);
      setAnalysisProgress(runState.progress);
    } finally {
      setIsRunning(false);
    }
  }

  function handleRestoreHistory(entry: LiteratureInsightHistoryEntry): void {
    setSelectedHistoryId(entry.id);
    setAnalysisResult(entry.result);
    setAnalysisProgress('');
  }

  function handleDeleteHistory(entryId: string): void {
    persistHistory(analysisHistory.filter((entry) => entry.id !== entryId));
    if (selectedHistoryId === entryId) {
      setAnalysisResult('');
    }
  }

  return (
    <main className="ai-assistant-page">
      <header className="ai-assistant-header">
        <div>
          <span className="eyebrow">AI Research Workbench</span>
          <h1>
            <img className="panel-title-icon" src={aiFillIcon} alt="" />
            <span>AI 助手</span>
          </h1>
          <p>集中管理大观分析、联网查新、提示词模板、API 参数和 AI 任务历史，让研究更高效。</p>
        </div>
        <div className="ai-assistant-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={props.onTestConnection} disabled={props.isBusy}>
            <img className="button-icon" src={refreshIcon} alt="" />
            <span>测试连接</span>
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={props.onSaveSettings} disabled={props.isBusy}>
            <img className="button-icon" src={saveIcon} alt="" />
            <span>保存配置</span>
          </button>
          <button
            type="button"
            className="primary-button button-with-icon"
            onClick={() => {
              setAnalysisResult('');
              setAnalysisProgress('');
              setAnalysisPrompt(DEFAULT_ANALYSIS_PROMPT);
            }}
          >
            <img className="button-icon" src={analysisIcon} alt="" />
            <span>新建分析任务</span>
          </button>
        </div>
      </header>

      <section className="ai-assistant-layout">
        <div className="ai-assistant-main-column">
          <section className="ai-work-card ai-analysis-workspace" id="ai-analysis-workspace">
            <div className="ai-card-header">
              <strong>
                <img className="panel-title-icon" src={analysisIcon} alt="" />
                <span>大观分析工作区</span>
              </strong>
              <span className="badge">{targetInputs.length > 0 ? `将分析 ${targetInputs.length} 篇` : '暂无可分析论文'}</span>
            </div>

            <div className="ai-analysis-controls">
              <label>
                分析对象
                <select value={analysisTarget} onChange={(event) => setAnalysisTarget(event.target.value as AnalysisTarget)}>
                  <option value="currentTable">当前研究表格</option>
                  <option value="currentPaper">当前论文</option>
                  <option value="linkedPapers">已绑定论文</option>
                  <option value="allPapers">全部论文库</option>
                </select>
              </label>
              <label>
                分析类型
                <select value={analysisType} onChange={(event) => setAnalysisType(event.target.value as AnalysisType)}>
                  {Object.entries(analysisTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                查新范围
                <select value={searchRange} onChange={(event) => setSearchRange(event.target.value)}>
                  <option>最近 30 天</option>
                  <option>最近 6 个月</option>
                  <option>全网</option>
                  <option>指定关键词</option>
                </select>
              </label>
              <label className="switch-field">
                联网查新
                <button
                  type="button"
                  className={`toggle-switch${webSearchEnabled ? ' is-on' : ''}`}
                  onClick={() => setWebSearchEnabled((value) => !value)}
                  aria-pressed={webSearchEnabled}
                >
                  <span />
                </button>
                <em>{webSearchEnabled ? '已开启' : '未开启'}</em>
              </label>
            </div>

            <label className="ai-prompt-editor">
              <span>分析提示词（支持手动编辑）</span>
              <textarea
                value={analysisPrompt}
                onChange={(event) => setAnalysisPrompt(event.target.value)}
                rows={7}
              />
            </label>

            <div className="ai-template-row">
              {promptTemplates.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className={template.content === analysisPrompt ? 'secondary-button is-active' : 'secondary-button'}
                  onClick={() => setAnalysisPrompt(template.content)}
                >
                  {template.label}
                </button>
              ))}
            </div>

            <div className="ai-analysis-actions">
              <button
                type="button"
                className="primary-button button-with-icon"
                disabled={targetInputs.length === 0 || props.isBusy || isRunning}
                onClick={handleStartAnalysis}
              >
                <img className="button-icon" src={analysisIcon} alt="" />
                <span>{isRunning ? '分析中...' : '开始分析'}</span>
              </button>
              <button type="button" className="secondary-button" disabled title="当前 API 请求暂不支持前端中断">
                停止生成
              </button>
              <button
                type="button"
                className="secondary-button button-with-icon"
                disabled={!analysisPrompt.trim()}
                onClick={() => void navigator.clipboard.writeText(analysisPrompt)}
              >
                <img className="button-icon" src={saveIcon} alt="" />
                <span>复制提示词</span>
              </button>
            </div>
          </section>

          <section className="ai-work-card ai-result-card">
            <div className="ai-card-header">
              <strong>分析结果</strong>
              <div className="ai-card-actions">
                <span className="badge">{analysisProgress ? '生成中' : analysisResult ? '自动保存中' : '待分析'}</span>
                <button
                  type="button"
                  className="secondary-button button-with-icon"
                  disabled={!analysisResult}
                  onClick={() => void navigator.clipboard.writeText(analysisResult)}
                >
                  <img className="button-icon" src={saveIcon} alt="" />
                  <span>复制结果</span>
                </button>
              </div>
            </div>
            {analysisProgress ? (
              <div className="ai-progress-box">
                <div className="indeterminate-progress" />
                <p>{analysisProgress}</p>
              </div>
            ) : analysisResult ? (
              <InsightMarkdown text={analysisResult} />
            ) : (
              <p className="empty-hint">选择分析对象和模板后点击“开始分析”，结果会显示在这里，不会挤压研究表格主体。</p>
            )}
          </section>

          <section className="ai-work-card ai-history-card">
            <div className="ai-card-header">
              <strong>分析历史</strong>
              <span className="badge">共 {analysisHistory.length} 条记录</span>
            </div>
            {analysisHistory.length > 0 ? (
              <div className="ai-history-list">
                {analysisHistory.map((entry) => (
                  <article key={entry.id} className={entry.id === selectedHistoryId ? 'ai-history-item active' : 'ai-history-item'}>
                    <div>
                      <strong>{entry.title}</strong>
                      <small>
                        {new Date(entry.createdAt).toLocaleString()} · {entry.paperCount} 篇 · {entry.model || 'unknown'}
                        {entry.webSearchUsed ? ' · 联网' : ' · 未联网'}
                      </small>
                    </div>
                    <div>
                      <button type="button" className="ghost-button" onClick={() => handleRestoreHistory(entry)}>
                        查看
                      </button>
                      <button type="button" className="ghost-button danger" onClick={() => handleDeleteHistory(entry.id)}>
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-hint">还没有分析历史。完成一次大观分析后会自动保存到这里。</p>
            )}
          </section>
        </div>

        <aside className="ai-assistant-side-column">
          <section className="ai-work-card ai-api-card" id="ai-settings-panel">
            <div className="ai-card-header">
              <strong>
                <img className="panel-title-icon" src={settingsIcon} alt="" />
                <span>API 设置</span>
              </strong>
              <span className={props.aiSettings?.apiKeyConfigured ? 'badge success' : 'badge'}>
                API Key {props.aiSettings?.apiKeyConfigured ? '已保存' : '未保存'}
              </span>
            </div>
            <div className="ai-settings-grid">
              <label>
                Provider
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
                Model
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
                Base URL
                <input
                  value={props.aiForm.baseURL}
                  disabled={props.isBusy}
                  onChange={(event) => props.onAiFormChange({ baseURL: event.target.value })}
                />
              </label>
              <label>
                API Key
                <input
                  value={props.aiForm.apiKey}
                  type="password"
                  disabled={props.isBusy}
                  placeholder={props.aiSettings?.apiKeyConfigured ? '已保存，留空继续使用' : '粘贴 API Key'}
                  onChange={(event) => props.onAiFormChange({ apiKey: event.target.value })}
                />
              </label>
            </div>
            <div className="ai-settings-actions">
              <button type="button" className="secondary-button" disabled={props.isBusy} onClick={props.onTestConnection}>
                测试连接
              </button>
              <button type="button" className="secondary-button" disabled={props.isBusy} onClick={props.onRefreshBalance}>
                查询余额
              </button>
              <button type="button" className="secondary-button" disabled={props.isBusy} onClick={props.onRefreshModels}>
                刷新模型
              </button>
            </div>
            {props.aiBalance ? <p className="subtle">{props.aiBalance.message}</p> : null}
          </section>

          <section className={`ai-work-card ai-advanced-card${advancedOpen ? ' is-open' : ''}`}>
            <button type="button" className="collapsible-card-summary" onClick={() => setAdvancedOpen((value) => !value)}>
              <span>
                <img className="panel-title-icon" src={settingsIcon} alt="" />
                API 高级设置
              </span>
              <em>{advancedOpen ? '已展开' : '已收起'}</em>
            </button>
            {advancedOpen ? (
              <>
                <div className="ai-settings-grid">
                  <label>
                    思考模式
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
                  {props.aiForm.provider === 'openai' ? (
                    <label>
                      OpenAI 推理强度
                      <select
                        value={props.aiForm.reasoningEffort ?? 'auto'}
                        disabled={props.isBusy}
                        onChange={(event) =>
                          props.onAiFormChange({ reasoningEffort: event.target.value as AiReasoningEffort })
                        }
                      >
                        {AI_REASONING_EFFORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="field-note">OpenAI 推理强度只在 OpenAI provider 下显示；当前 provider 使用思考模式、Temperature 和 Top P 控制。</p>
                  )}
                  <label>
                    Temperature
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={props.aiForm.temperature ?? ''}
                      disabled={props.isBusy}
                      onChange={(event) => props.onAiFormChange({ temperature: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Top P
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={props.aiForm.topP ?? ''}
                      disabled={props.isBusy}
                      onChange={(event) => props.onAiFormChange({ topP: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Max tokens
                    <input
                      type="number"
                      min="1"
                      step="256"
                      value={props.aiForm.maxTokens ?? ''}
                      disabled={props.isBusy}
                      onChange={(event) => props.onAiFormChange({ maxTokens: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    超时（秒）
                    <input
                      type="number"
                      min="10"
                      step="10"
                      value={props.aiForm.timeoutSeconds ?? ''}
                      disabled={props.isBusy}
                      onChange={(event) => props.onAiFormChange({ timeoutSeconds: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    重试次数
                    <input
                      type="number"
                      min="0"
                      max="8"
                      value={props.aiForm.maxRetries ?? ''}
                      disabled={props.isBusy}
                      onChange={(event) => props.onAiFormChange({ maxRetries: readOptionalNumberInput(event.target.value) })}
                    />
                  </label>
                </div>
                <p className="subtle">{describeAiRuntimeOptions(props.aiForm)}</p>
                <button type="button" className="primary-button" disabled={props.isBusy} onClick={props.onSaveSettings}>
                  保存设置
                </button>
              </>
            ) : null}
          </section>

          <section className="ai-work-card ai-search-card">
            <div className="ai-card-header">
              <strong>联网查新设置</strong>
              <button
                type="button"
                className={`toggle-switch${webSearchEnabled ? ' is-on' : ''}`}
                onClick={() => setWebSearchEnabled((value) => !value)}
                aria-pressed={webSearchEnabled}
              >
                <span />
              </button>
            </div>
            <div className="ai-settings-grid">
              <label>
                查新范围
                <select value={searchRange} onChange={(event) => setSearchRange(event.target.value)}>
                  <option>最近 30 天</option>
                  <option>最近 6 个月</option>
                  <option>全网</option>
                  <option>指定关键词</option>
                </select>
              </label>
              <label>
                关键词（可选）
                <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="用逗号分隔" />
              </label>
              <label>
                引用格式
                <select defaultValue="APA">
                  <option>APA</option>
                  <option>IEEE</option>
                  <option>链接 + 摘要</option>
                </select>
              </label>
            </div>
            <label className="checkbox-line">
              <input type="checkbox" defaultChecked />
              <span>将查新结论写入大观分析结果</span>
            </label>
          </section>

          <section className="ai-work-card ai-template-card">
            <div className="ai-card-header">
              <strong>提示词模板</strong>
              <button type="button" className="ghost-button" onClick={() => setAnalysisPrompt(DEFAULT_ANALYSIS_PROMPT)}>
                恢复默认
              </button>
            </div>
            <div className="ai-template-list">
              {promptTemplates.map((template) => (
                <button key={template.key} type="button" onClick={() => setAnalysisPrompt(template.content)}>
                  <strong>{template.label}</strong>
                  <span>{template.content.slice(0, 34)}...</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function resolveAnalysisInputs(
  target: AnalysisTarget,
  papers: PaperRecord[],
  linkedInputs: LiteratureGapPaperInput[],
  activePaper: PaperRecord | null
): LiteratureGapPaperInput[] {
  if (target === 'currentPaper') {
    return activePaper ? [{ paper: activePaper, rowValues: {} }] : [];
  }

  if (target === 'allPapers') {
    return papers.map((paper) => ({ paper, rowValues: {} }));
  }

  return linkedInputs.length > 0 ? linkedInputs : papers.map((paper) => ({ paper, rowValues: {} }));
}

function buildLinkedLiteratureInputs(
  workbook: ResearchWorkbook,
  links: ResearchSheetLink[],
  papers: PaperRecord[]
): LiteratureGapPaperInput[] {
  return workbook.rows
    .map((_row, rowIndex) => {
      if (rowIndex === 0) {
        return null;
      }

      const rowId = workbook.rows[rowIndex]?.id ?? `row-${rowIndex}`;
      const paperId = links.find((link) => link.rowId === rowId)?.paperId;
      const paper = paperId ? papers.find((item) => item.id === paperId) : null;
      if (!paper) {
        return null;
      }

      return {
        paper,
        rowValues: getResearchRowValues(workbook, rowIndex)
      };
    })
    .filter((item): item is LiteratureGapPaperInput => Boolean(item));
}

function buildCustomPrompt(input: {
  analysisType: AnalysisType;
  webSearchEnabled: boolean;
  searchRange: string;
  keywords: string;
  analysisPrompt: string;
}): string {
  return [
    `分析类型：${analysisTypeLabels[input.analysisType]}`,
    `联网查新：${input.webSearchEnabled ? `开启，范围 ${input.searchRange}` : '关闭'}`,
    input.keywords.trim() ? `查新关键词：${input.keywords.trim()}` : '',
    '',
    input.analysisPrompt.trim()
  ]
    .filter(Boolean)
    .join('\n');
}

function readJsonFromLocalStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readOptionalNumberInput(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

export type { AiAssistantFocus };
