import type { ExperimentMatrixGroup, ExperimentMatrixRow, ExperimentMatrixStatus } from './experimentMatrix';

export type ExperimentMatrixGroupFilter = ExperimentMatrixGroup | 'all';
export type ExperimentMatrixStatusFilter = ExperimentMatrixStatus | 'all';

export interface ExperimentMatrixRowFilters {
  group: ExperimentMatrixGroupFilter;
  status: ExperimentMatrixStatusFilter;
  query: string;
}

export interface ExperimentMatrixRowsSummary {
  total: number;
  byGroup: Record<ExperimentMatrixGroup, number>;
  byStatus: Record<ExperimentMatrixStatus, number>;
  evidenceCovered: number;
  evidenceCoveragePercent: number;
}

export function summarizeExperimentMatrixRows(rows: ExperimentMatrixRow[]): ExperimentMatrixRowsSummary {
  const summary: ExperimentMatrixRowsSummary = {
    total: rows.length,
    byGroup: {
      baseline: 0,
      proposed: 0,
      ablation: 0
    },
    byStatus: {
      planned: 0,
      running: 0,
      blocked: 0,
      done: 0
    },
    evidenceCovered: 0,
    evidenceCoveragePercent: 0
  };

  for (const row of rows) {
    summary.byGroup[row.group] += 1;
    summary.byStatus[row.status] += 1;
    if (row.evidenceSourceIds.length > 0 || row.evidenceLocators.length > 0) {
      summary.evidenceCovered += 1;
    }
  }

  summary.evidenceCoveragePercent =
    rows.length === 0 ? 0 : Math.round((summary.evidenceCovered / rows.length) * 100);

  return summary;
}

export function filterExperimentMatrixRows(
  rows: ExperimentMatrixRow[],
  filters: ExperimentMatrixRowFilters
): ExperimentMatrixRow[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();

  return rows.filter((row) => {
    if (filters.group !== 'all' && row.group !== filters.group) {
      return false;
    }

    if (filters.status !== 'all' && row.status !== filters.status) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return buildSearchText(row).includes(normalizedQuery);
  });
}

export function selectExperimentMatrixRow(rows: ExperimentMatrixRow[], selectedRowId: string | null): ExperimentMatrixRow | null {
  if (rows.length === 0) {
    return null;
  }

  return rows.find((row) => row.id === selectedRowId) ?? rows[0];
}

function buildSearchText(row: ExperimentMatrixRow): string {
  return [
    row.id,
    row.paper,
    row.group,
    row.hypothesis,
    row.baseline,
    row.proposed,
    row.ablation,
    row.controlledVariables,
    row.seeds,
    row.metrics,
    row.expectedResult,
    row.status,
    ...row.evidenceSourceIds,
    ...row.evidenceLocators
  ]
    .join(' ')
    .toLocaleLowerCase();
}
