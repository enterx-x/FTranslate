import type { MethodCard, MethodCardField, MethodCardFieldKey } from './methodCards';
import type { ResearchRow, ResearchSheetColumn, ResearchWorkbook } from './researchWorkbook';

export const EXPERIMENT_MATRIX_KEY = 'pdfTranslationReader:experimentMatrix';
export const EXPERIMENT_MATRICES_KEY = 'pdfTranslationReader:experimentMatrices';

export type ExperimentMatrixGroup = 'baseline' | 'proposed' | 'ablation';
export type ExperimentMatrixStatus = 'planned' | 'running' | 'blocked' | 'done';

export type ExperimentMatrixColumnKey =
  | 'paper'
  | 'group'
  | 'hypothesis'
  | 'baseline'
  | 'proposed'
  | 'ablation'
  | 'controlledVariables'
  | 'seeds'
  | 'metrics'
  | 'expectedResult'
  | 'status'
  | 'evidence';

export interface ExperimentMatrixRow {
  id: string;
  projectId: string;
  paperId: string;
  methodCardId: string;
  group: ExperimentMatrixGroup;
  paper: string;
  hypothesis: string;
  baseline: string;
  proposed: string;
  ablation: string;
  controlledVariables: string;
  seeds: string;
  metrics: string;
  expectedResult: string;
  status: ExperimentMatrixStatus;
  evidenceSourceIds: string[];
  evidenceLocators: string[];
}

export interface ExperimentMatrixState {
  projectId: string;
  rows: ExperimentMatrixRow[];
  selectedRowId: string | null;
  updatedAt: string;
  version: number;
}

export const EXPERIMENT_MATRIX_COLUMNS: ResearchSheetColumn[] = [
  { key: 'paper', label: '论文', width: 220 },
  { key: 'group', label: '实验组', width: 120 },
  { key: 'hypothesis', label: '假设', width: 280 },
  { key: 'baseline', label: 'Baseline', width: 240 },
  { key: 'proposed', label: 'Proposed Method', width: 280 },
  { key: 'ablation', label: 'Ablation', width: 220 },
  { key: 'controlledVariables', label: '控制变量', width: 260 },
  { key: 'seeds', label: 'Seeds', width: 120 },
  { key: 'metrics', label: '指标', width: 240 },
  { key: 'expectedResult', label: '预期结果', width: 260 },
  { key: 'status', label: '状态', width: 120 },
  { key: 'evidence', label: '证据', width: 320 }
];

const DEFAULT_SEEDS = '1, 2, 3';

export function buildExperimentMatrixRowsFromMethodCard(card: MethodCard): ExperimentMatrixRow[] {
  const rows: ExperimentMatrixRow[] = [];
  const baseline = getGroundedField(card, 'baseline');
  const metrics = getGroundedField(card, 'metrics');
  const dataset = getGroundedField(card, 'datasetOrEnvironment');
  const method = getFirstGroundedField(card, ['modelArchitecture', 'trainingObjective', 'lossFunction']);
  const constraints = getGroundedField(card, 'constraints');
  const contribution = getGroundedField(card, 'claimedContribution');

  if (baseline && metrics) {
    rows.push(
      buildMatrixRow(card, 'baseline', {
        hypothesis: `复现并确认 baseline：${baseline.value}`,
        baseline: baseline.value,
        controlledVariables: dataset?.value ?? '',
        metrics: metrics.value,
        expectedResult: '确认论文 reported metrics 和可复现上限。',
        evidenceFields: [baseline, metrics, dataset]
      })
    );
  }

  if (method) {
    rows.push(
      buildMatrixRow(card, 'proposed', {
        hypothesis: contribution?.value || '验证方法卡中的 proposed method 是否优于 baseline。',
        baseline: baseline?.value ?? '',
        proposed: joinFieldValues([method, constraints]),
        controlledVariables: dataset?.value ?? '',
        metrics: metrics?.value ?? '',
        expectedResult: contribution?.value || metrics?.value || '',
        evidenceFields: [method, constraints, contribution, metrics, dataset]
      })
    );
  }

  if (constraints && metrics) {
    rows.push(
      buildMatrixRow(card, 'ablation', {
        hypothesis: '验证安全约束对指标和失败模式的真实贡献。',
        baseline: baseline?.value ?? '',
        proposed: method?.value ?? '',
        ablation: `without ${constraints.value}`,
        controlledVariables: buildControlledVariables(dataset?.value),
        metrics: metrics.value,
        expectedResult: '如果约束有效，移除后应出现更高 violation / collision 或更低 success rate。',
        evidenceFields: [constraints, metrics, dataset]
      })
    );
  }

  return rows;
}

export function buildExperimentMatrixWorkbookFromMethodCards(cards: MethodCard[]): ResearchWorkbook {
  const matrixRows = cards.flatMap(buildExperimentMatrixRowsFromMethodCard);
  return buildExperimentMatrixWorkbookFromRows(matrixRows);
}

export function buildExperimentMatrixWorkbookFromRows(rows: ExperimentMatrixRow[]): ResearchWorkbook {
  return {
    id: 'experiment-matrix-workbook',
    sheetName: '实验矩阵',
    freeze: {
      ySplit: 1,
      xSplit: 0
    },
    columns: EXPERIMENT_MATRIX_COLUMNS,
    rows: [buildHeaderRow(), ...rows.map(toResearchRow)]
  };
}

export function exportExperimentMatrixMarkdown(rows: ExperimentMatrixRow[]): string {
  const header = EXPERIMENT_MATRIX_COLUMNS.map((column) => column.label);
  const bodyRows = rows.map((row) =>
    EXPERIMENT_MATRIX_COLUMNS.map((column) =>
      escapeMarkdownCell(toCellValue(row, column.key as ExperimentMatrixColumnKey))
    )
  );

  return [
    '# 实验矩阵',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...bodyRows.map((cells) => `| ${cells.join(' | ')} |`)
  ].join('\n');
}

export function parseExperimentMatrixStates(value: string | null): ExperimentMatrixState[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeExperimentMatrixState)
      .filter((state): state is ExperimentMatrixState => Boolean(state));
  } catch {
    return [];
  }
}

export function serializeExperimentMatrixStates(states: ExperimentMatrixState[]): string {
  return JSON.stringify(states, null, 2);
}

export function mergeGeneratedExperimentRows(
  currentRows: ExperimentMatrixRow[],
  generatedRows: ExperimentMatrixRow[]
): ExperimentMatrixRow[] {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const generatedIds = new Set(generatedRows.map((row) => row.id));
  const mergedRows = generatedRows.map((generated) => currentById.get(generated.id) ?? generated);
  return [...mergedRows, ...currentRows.filter((row) => !generatedIds.has(row.id))];
}

export function updateExperimentMatrixRow(
  rows: ExperimentMatrixRow[],
  rowId: string,
  patch: Partial<Omit<ExperimentMatrixRow, 'id' | 'projectId' | 'paperId' | 'methodCardId'>>
): ExperimentMatrixRow[] {
  return rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
}

function buildMatrixRow(
  card: MethodCard,
  group: ExperimentMatrixGroup,
  input: {
    hypothesis: string;
    baseline?: string;
    proposed?: string;
    ablation?: string;
    controlledVariables?: string;
    metrics?: string;
    expectedResult?: string;
    evidenceFields: Array<MethodCardField | null | undefined>;
  }
): ExperimentMatrixRow {
  const evidenceSourceIds = uniqueValues(
    input.evidenceFields.flatMap((field) => (field?.value ? field.evidenceSourceIds : []))
  );
  const evidenceLocators = evidenceSourceIds
    .map((sourceId) => card.evidenceSources.find((source) => source.id === sourceId)?.locator ?? sourceId)
    .filter(Boolean);

  return {
    id: `matrix-${card.id}-${group}-${hashText(evidenceSourceIds.join('|') || input.hypothesis)}`,
    projectId: card.projectId,
    paperId: card.paperId,
    methodCardId: card.id,
    group,
    paper: card.title,
    hypothesis: input.hypothesis,
    baseline: input.baseline ?? '',
    proposed: input.proposed ?? '',
    ablation: input.ablation ?? '',
    controlledVariables: input.controlledVariables ?? '',
    seeds: DEFAULT_SEEDS,
    metrics: input.metrics ?? '',
    expectedResult: input.expectedResult ?? '',
    status: 'planned',
    evidenceSourceIds,
    evidenceLocators
  };
}

function normalizeExperimentMatrixState(value: unknown): ExperimentMatrixState | null {
  if (!isRecord(value)) {
    return null;
  }

  const projectId = readString(value.projectId);
  if (!projectId || !Array.isArray(value.rows)) {
    return null;
  }

  const rows = value.rows.map(normalizeExperimentMatrixRow).filter((row): row is ExperimentMatrixRow => Boolean(row));
  const selectedRowId = value.selectedRowId === null ? null : readString(value.selectedRowId) || null;
  const updatedAt = readString(value.updatedAt) || new Date(0).toISOString();
  const version = Math.max(1, Number(value.version) || 1);

  return {
    projectId,
    rows,
    selectedRowId,
    updatedAt,
    version
  };
}

function normalizeExperimentMatrixRow(value: unknown): ExperimentMatrixRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const projectId = readString(value.projectId);
  const paperId = readString(value.paperId);
  const methodCardId = readString(value.methodCardId);
  const group = readExperimentGroup(value.group);
  const status = readExperimentStatus(value.status);

  if (!id || !projectId || !paperId || !methodCardId || !group || !status) {
    return null;
  }

  return {
    id,
    projectId,
    paperId,
    methodCardId,
    group,
    paper: readString(value.paper),
    hypothesis: readString(value.hypothesis),
    baseline: readString(value.baseline),
    proposed: readString(value.proposed),
    ablation: readString(value.ablation),
    controlledVariables: readString(value.controlledVariables),
    seeds: readString(value.seeds),
    metrics: readString(value.metrics),
    expectedResult: readString(value.expectedResult),
    status,
    evidenceSourceIds: readStringArray(value.evidenceSourceIds),
    evidenceLocators: readStringArray(value.evidenceLocators)
  };
}

function readExperimentGroup(value: unknown): ExperimentMatrixGroup | null {
  return value === 'baseline' || value === 'proposed' || value === 'ablation' ? value : null;
}

function readExperimentStatus(value: unknown): ExperimentMatrixStatus | null {
  return value === 'planned' || value === 'running' || value === 'blocked' || value === 'done' ? value : null;
}

function toResearchRow(row: ExperimentMatrixRow): ResearchRow {
  return {
    id: row.id,
    height: 72,
    cells: EXPERIMENT_MATRIX_COLUMNS.map((column) => ({
      value: toCellValue(row, column.key as ExperimentMatrixColumnKey)
    }))
  };
}

function toCellValue(row: ExperimentMatrixRow, key: ExperimentMatrixColumnKey): string {
  if (key === 'evidence') {
    return row.evidenceLocators.join('\n');
  }
  return String(row[key] ?? '');
}

function buildHeaderRow(): ResearchRow {
  return {
    id: 'header',
    cells: EXPERIMENT_MATRIX_COLUMNS.map((column) => ({
      value: column.label,
      style: {
        bold: true,
        fontSize: 13,
        color: '#ffffff',
        backgroundColor: '#111111',
        align: 'center'
      }
    }))
  };
}

function getGroundedField(card: MethodCard, key: MethodCardFieldKey): MethodCardField | null {
  const field = card.fields.find((item) => item.key === key);
  if (!field?.value.trim() || field.evidenceSourceIds.length === 0) {
    return null;
  }
  return field;
}

function getFirstGroundedField(card: MethodCard, keys: MethodCardFieldKey[]): MethodCardField | null {
  for (const key of keys) {
    const field = getGroundedField(card, key);
    if (field) {
      return field;
    }
  }
  return null;
}

function joinFieldValues(fields: Array<MethodCardField | null | undefined>): string {
  return uniqueValues(fields.map((field) => field?.value.trim() ?? '').filter(Boolean)).join('\n');
}

function buildControlledVariables(datasetOrEnvironment: string | undefined): string {
  const base = datasetOrEnvironment?.trim();
  return base
    ? `保持 ${base}、baseline、metrics 和 seeds 不变。`
    : '保持 baseline、metrics 和 seeds 不变。';
}

function uniqueValues(values: string[]): string[] {
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || result.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    result.push(normalized);
  });
  return result;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\r?\n/gu, '<br>').replace(/\|/gu, '\\|').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
