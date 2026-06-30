import { useEffect, useMemo, useState } from 'react';
import {
  EXPERIMENT_MATRICES_KEY,
  mergeGeneratedExperimentRows,
  parseExperimentMatrixStates,
  serializeExperimentMatrixStates,
  updateExperimentMatrixRow,
  type ExperimentMatrixRow,
  type ExperimentMatrixState
} from '../lib/experimentMatrix';

type ExperimentMatrixStorage = Pick<Storage, 'getItem' | 'setItem'>;

function createEmptyState(projectId: string): ExperimentMatrixState {
  return {
    projectId,
    rows: [],
    selectedRowId: null,
    updatedAt: new Date().toISOString(),
    version: 1
  };
}

export function readExperimentMatrixStatesFromStorage(
  storage: ExperimentMatrixStorage | undefined = globalThis.localStorage
): ExperimentMatrixState[] {
  return parseExperimentMatrixStates(storage?.getItem(EXPERIMENT_MATRICES_KEY) ?? null);
}

export function writeExperimentMatrixStatesToStorage(
  states: ExperimentMatrixState[],
  storage: ExperimentMatrixStorage | undefined = globalThis.localStorage
): void {
  storage?.setItem(EXPERIMENT_MATRICES_KEY, serializeExperimentMatrixStates(states));
}

export function upsertExperimentMatrixState(
  states: ExperimentMatrixState[],
  nextState: ExperimentMatrixState
): ExperimentMatrixState[] {
  return [nextState, ...states.filter((state) => state.projectId !== nextState.projectId)];
}

export function useExperimentMatrix(projectId: string) {
  const [states, setStates] = useState<ExperimentMatrixState[]>(() => readExperimentMatrixStatesFromStorage());
  const matrixState = useMemo(
    () => states.find((state) => state.projectId === projectId) ?? createEmptyState(projectId),
    [projectId, states]
  );

  useEffect(() => {
    writeExperimentMatrixStatesToStorage(states);
  }, [states]);

  const saveState = (nextState: ExperimentMatrixState) => {
    setStates((current) => upsertExperimentMatrixState(current, nextState));
  };

  const setRows = (rows: ExperimentMatrixRow[]) => {
    saveState({
      ...matrixState,
      rows,
      updatedAt: new Date().toISOString(),
      version: Math.max(1, matrixState.version)
    });
  };

  const mergeGeneratedRows = (rows: ExperimentMatrixRow[]) => {
    setRows(mergeGeneratedExperimentRows(matrixState.rows, rows));
  };

  const patchRow = (rowId: string, patch: Parameters<typeof updateExperimentMatrixRow>[2]) => {
    setRows(updateExperimentMatrixRow(matrixState.rows, rowId, patch));
  };

  const selectRow = (rowId: string | null) => {
    saveState({
      ...matrixState,
      selectedRowId: rowId,
      updatedAt: new Date().toISOString()
    });
  };

  return {
    matrixState,
    setRows,
    mergeGeneratedRows,
    patchRow,
    selectRow
  };
}
