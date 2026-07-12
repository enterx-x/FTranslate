import { useMemo, useState } from 'react';
import aiFillIcon from '../assets/icons/duotone/ai-fill.svg';
import backIcon from '../assets/icons/duotone/back.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import {
  exportExperimentMatrixMarkdown,
  type ExperimentMatrixRow,
  type ExperimentMatrixState,
  type ExperimentMatrixStatus
} from '../lib/experimentMatrix';
import type { MethodCardExperimentBridgeSummary } from '../lib/experimentMatrixBridge';
import {
  filterExperimentMatrixRows,
  selectExperimentMatrixRow,
  summarizeExperimentMatrixRows,
  type ExperimentMatrixGroupFilter,
  type ExperimentMatrixStatusFilter
} from '../lib/experimentMatrixView';

interface ExperimentMatrixPageProps {
  projectName: string;
  paperCount: number;
  matrixState: ExperimentMatrixState;
  methodCardBridgeSummary: MethodCardExperimentBridgeSummary;
  onBackHome: () => void;
  onOpenResearchSheet: () => void;
  onGenerateFromMethodCards: () => void;
  onSelectRow: (rowId: string) => void;
  onPatchRowStatus: (rowId: string, status: ExperimentMatrixStatus) => void;
  onStatusMessage: (message: string) => void;
}

const groupOptions: Array<{ value: ExperimentMatrixGroupFilter; label: string }> = [
  { value: 'all', label: '全部实验组' },
  { value: 'baseline', label: 'Baseline' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'ablation', label: 'Ablation' }
];

const statusOptions: Array<{ value: ExperimentMatrixStatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'planned', label: 'Planned' },
  { value: 'running', label: 'Running' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' }
];

const statusActions: Array<{ value: ExperimentMatrixStatus; label: string }> = [
  { value: 'planned', label: '计划' },
  { value: 'running', label: '运行中' },
  { value: 'blocked', label: '阻塞' },
  { value: 'done', label: '完成' }
];

export function ExperimentMatrixPage(props: ExperimentMatrixPageProps) {
  const [groupFilter, setGroupFilter] = useState<ExperimentMatrixGroupFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ExperimentMatrixStatusFilter>('all');
  const [query, setQuery] = useState('');
  const rows = props.matrixState.rows;
  const summary = useMemo(() => summarizeExperimentMatrixRows(rows), [rows]);
  const visibleRows = useMemo(
    () =>
      filterExperimentMatrixRows(rows, {
        group: groupFilter,
        status: statusFilter,
        query
      }),
    [groupFilter, query, rows, statusFilter]
  );
  const selectedRow = useMemo(
    () => selectExperimentMatrixRow(visibleRows, props.matrixState.selectedRowId),
    [props.matrixState.selectedRowId, visibleRows]
  );

  async function handleCopyMarkdown(): Promise<void> {
    if (rows.length === 0) {
      props.onStatusMessage('实验矩阵为空，暂无可复制内容。');
      return;
    }

    try {
      await navigator.clipboard.writeText(exportExperimentMatrixMarkdown(rows));
      props.onStatusMessage('已复制实验矩阵 Markdown。');
    } catch (error) {
      props.onStatusMessage(`复制实验矩阵失败：${String(error)}`);
    }
  }

  return (
    <main className="experiment-matrix-page" data-page="experiment-matrix">
      <header className="experiment-matrix-header">
        <div className="experiment-matrix-title">
          <img src={researchSheetIcon} alt="" />
          <div>
            <span className="eyebrow">Experiment Matrix</span>
            <h1>实验矩阵</h1>
            <p>{props.projectName} · {props.paperCount} 篇论文对象 · 独立于研究表格的结构化实验设计层</p>
          </div>
        </div>
        <div className="experiment-matrix-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={props.onBackHome}>
            <img className="button-icon" src={backIcon} alt="" />
            <span>项目空间</span>
          </button>
          <button type="button" className="secondary-button" onClick={props.onOpenResearchSheet}>
            研究表格
          </button>
          <button
            type="button"
            className="primary-button button-with-icon"
            onClick={() => void handleCopyMarkdown()}
            disabled={rows.length === 0}
          >
            <img className="button-icon" src={downloadIcon} alt="" />
            <span>复制 Markdown</span>
          </button>
        </div>
      </header>

      <section className="experiment-matrix-source-strip" aria-label="方法卡实验生成入口">
        <div>
          <span className="eyebrow">Method Card Bridge</span>
          <strong>
            {props.methodCardBridgeSummary.methodCardCount} 张方法卡 · 可合并 {props.methodCardBridgeSummary.generatedRowCount} 行实验
          </strong>
          <p>
            {props.methodCardBridgeSummary.groundedMethodCardCount} 张有证据闭环 · {props.methodCardBridgeSummary.evidenceLocatorCount} 个证据定位 · 已编辑行保持优先
          </p>
        </div>
        <button
          type="button"
          className="secondary-button button-with-icon"
          onClick={props.onGenerateFromMethodCards}
          disabled={props.methodCardBridgeSummary.generatedRowCount === 0}
        >
          <img className="button-icon" src={aiFillIcon} alt="" />
          <span>从方法卡合并</span>
        </button>
      </section>

      <section className="experiment-matrix-summary" aria-label="实验矩阵摘要">
        <SummaryItem label="实验行" value={summary.total} />
        <SummaryItem label="Baseline" value={summary.byGroup.baseline} />
        <SummaryItem label="Proposed" value={summary.byGroup.proposed} />
        <SummaryItem label="Ablation" value={summary.byGroup.ablation} />
        <SummaryItem label="证据覆盖" value={`${summary.evidenceCoveragePercent}%`} detail={`${summary.evidenceCovered}/${summary.total}`} />
      </section>

      <section className="experiment-matrix-workbench">
        <section className="experiment-matrix-main" aria-label="实验矩阵表格">
          <div className="experiment-matrix-toolbar">
            <label>
              <span>实验组</span>
              <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as ExperimentMatrixGroupFilter)}>
                {groupOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>状态</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ExperimentMatrixStatusFilter)}>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="experiment-matrix-search">
              <span>检索</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="论文、假设、metric、证据定位"
              />
            </label>
          </div>

          <div className="experiment-matrix-table-wrap">
            {visibleRows.length > 0 ? (
              <>
                <table className="experiment-matrix-table">
                  <thead>
                    <tr>
                      <th>实验组</th>
                      <th>论文</th>
                      <th>假设</th>
                      <th>方法 / 消融</th>
                      <th>指标</th>
                      <th>状态</th>
                      <th>证据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr
                        key={row.id}
                        className={selectedRow?.id === row.id ? 'is-selected' : ''}
                        tabIndex={0}
                        aria-selected={selectedRow?.id === row.id}
                        onClick={() => props.onSelectRow(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            props.onSelectRow(row.id);
                          }
                        }}
                      >
                        <td><span className={`experiment-badge group-${row.group}`}>{formatGroup(row.group)}</span></td>
                        <td>{row.paper || '-'}</td>
                        <td>{row.hypothesis || '-'}</td>
                        <td>{formatMethodCell(row)}</td>
                        <td>{row.metrics || '-'}</td>
                        <td><span className={`experiment-badge status-${row.status}`}>{formatStatus(row.status)}</span></td>
                        <td>{row.evidenceLocators.join(' · ') || '未绑定证据'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleRows.length < 3 ? (
                  <div className="experiment-matrix-density-hint" aria-live="polite">
                    <span aria-hidden="true">＋</span>
                    <div>
                      <strong>当前筛选显示 {visibleRows.length} 行</strong>
                      <p>继续从方法卡补齐 Baseline、Proposed 与 Ablation，形成可审查的对照实验网格。</p>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyMatrixState
                hasRows={rows.length > 0}
                bridgeSummary={props.methodCardBridgeSummary}
                onGenerateFromMethodCards={props.onGenerateFromMethodCards}
                onOpenResearchSheet={props.onOpenResearchSheet}
              />
            )}
          </div>
        </section>

        <aside className="experiment-matrix-detail" aria-label="选中实验详情">
          {selectedRow ? (
            <ExperimentDetail
              key={selectedRow.id}
              row={selectedRow}
              onPatchStatus={(status) => props.onPatchRowStatus(selectedRow.id, status)}
            />
          ) : (
            <div className="experiment-matrix-detail-empty">
              <span className="eyebrow">No Experiment</span>
              <h2>还没有实验行</h2>
              <p>先从方法卡生成或确认实验矩阵，再在这里审查假设、控制变量、指标和证据定位。</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function SummaryItem(props: { label: string; value: number | string; detail?: string }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
    </div>
  );
}

function EmptyMatrixState(props: {
  hasRows: boolean;
  bridgeSummary: MethodCardExperimentBridgeSummary;
  onGenerateFromMethodCards: () => void;
  onOpenResearchSheet: () => void;
}) {
  const canGenerate = !props.hasRows && props.bridgeSummary.generatedRowCount > 0;
  return (
    <div className="experiment-matrix-empty">
      <span className="eyebrow">{props.hasRows ? 'No Match' : 'Empty Matrix'}</span>
      <h2>{props.hasRows ? '当前筛选没有匹配实验' : '尚未生成或确认实验矩阵'}</h2>
      <p>
        {props.hasRows
          ? '放宽实验组、状态或关键词筛选后再审查。'
          : props.bridgeSummary.methodCardCount > 0
            ? `当前项目有 ${props.bridgeSummary.methodCardCount} 张方法卡，其中 ${props.bridgeSummary.groundedMethodCardCount} 张可形成实验候选。`
            : '实验矩阵必须来自有证据的方法卡或人工确认的实验行，不能把自由研究表格直接伪装成实验设计。'}
      </p>
      <div className="experiment-matrix-empty-actions">
        {canGenerate ? (
          <button type="button" className="primary-button button-with-icon" onClick={props.onGenerateFromMethodCards}>
            <img className="button-icon" src={aiFillIcon} alt="" />
            <span>从方法卡合并</span>
          </button>
        ) : null}
        <button type="button" className="secondary-button" onClick={props.onOpenResearchSheet}>
          打开研究表格
        </button>
      </div>
    </div>
  );
}

function ExperimentDetail(props: {
  row: ExperimentMatrixRow;
  onPatchStatus: (status: ExperimentMatrixStatus) => void;
}) {
  return (
    <>
      <div className="experiment-detail-head">
        <span className={`experiment-badge group-${props.row.group}`}>{formatGroup(props.row.group)}</span>
        <h2>{props.row.hypothesis || props.row.paper}</h2>
        <p>{props.row.paper}</p>
      </div>
      <div className="experiment-detail-status">
        {statusActions.map((action) => (
          <button
            key={action.value}
            type="button"
            className={props.row.status === action.value ? 'is-active' : ''}
            onClick={() => props.onPatchStatus(action.value)}
          >
            {action.label}
          </button>
        ))}
      </div>
      <dl className="experiment-detail-list">
        <DetailItem label="Baseline" value={props.row.baseline} />
        <DetailItem label="Proposed Method" value={props.row.proposed} />
        <DetailItem label="Ablation" value={props.row.ablation} />
        <DetailItem label="控制变量" value={props.row.controlledVariables} />
        <DetailItem label="Seeds" value={props.row.seeds} />
        <DetailItem label="Metrics" value={props.row.metrics} />
        <DetailItem label="预期结果" value={props.row.expectedResult} />
      </dl>
      <section className="experiment-evidence-panel">
        <div>
          <span className="eyebrow">Evidence</span>
          <strong>{props.row.evidenceLocators.length} 条定位</strong>
        </div>
        {props.row.evidenceLocators.length > 0 ? (
          <ul>
            {props.row.evidenceLocators.map((locator) => (
              <li key={locator}>{locator}</li>
            ))}
          </ul>
        ) : (
          <p>该实验行缺少证据定位，需要回到方法卡或研究表格补证据后再执行。</p>
        )}
      </section>
    </>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.value || '-'}</dd>
    </div>
  );
}

function formatMethodCell(row: ExperimentMatrixRow): string {
  if (row.group === 'ablation') {
    return row.ablation || row.proposed || '-';
  }
  return row.proposed || row.baseline || '-';
}

function formatGroup(group: ExperimentMatrixRow['group']): string {
  if (group === 'baseline') {
    return 'Baseline';
  }
  if (group === 'proposed') {
    return 'Proposed';
  }
  return 'Ablation';
}

function formatStatus(status: ExperimentMatrixStatus): string {
  if (status === 'planned') {
    return 'Planned';
  }
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'blocked') {
    return 'Blocked';
  }
  return 'Done';
}
