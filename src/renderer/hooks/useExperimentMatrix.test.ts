import { beforeEach, describe, expect, it } from 'vitest';
import { EXPERIMENT_MATRICES_KEY, type ExperimentMatrixState } from '../lib/experimentMatrix';
import {
  readExperimentMatrixStatesFromStorage,
  upsertExperimentMatrixState,
  writeExperimentMatrixStatesToStorage
} from './useExperimentMatrix';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
}

describe('useExperimentMatrix storage helpers', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('initializes project-scoped matrix states from storage', () => {
    const state: ExperimentMatrixState = {
      projectId: 'project-a',
      rows: [],
      selectedRowId: null,
      updatedAt: '2026-06-30T10:00:00.000Z',
      version: 3
    };
    storage.setItem(EXPERIMENT_MATRICES_KEY, JSON.stringify([state]));

    expect(readExperimentMatrixStatesFromStorage(storage)).toEqual([state]);
  });

  it('persists an upserted matrix state for one project without dropping other projects', () => {
    const otherState: ExperimentMatrixState = {
      projectId: 'project-b',
      rows: [],
      selectedRowId: null,
      updatedAt: '2026-06-30T09:00:00.000Z',
      version: 1
    };
    const nextState: ExperimentMatrixState = {
      projectId: 'project-a',
      rows: [],
      selectedRowId: null,
      updatedAt: '2026-06-30T10:00:00.000Z',
      version: 1
    };

    const states = upsertExperimentMatrixState([otherState], nextState);
    writeExperimentMatrixStatesToStorage(states, storage);

    const saved = JSON.parse(storage.getItem(EXPERIMENT_MATRICES_KEY) ?? '[]') as ExperimentMatrixState[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ projectId: 'project-a', rows: [], version: 1 });
    expect(saved[1]).toMatchObject({ projectId: 'project-b', rows: [], version: 1 });
  });
});
