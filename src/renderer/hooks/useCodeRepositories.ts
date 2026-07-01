import { useCallback, useMemo, useState } from 'react';
import {
  CODE_REPOSITORIES_KEY,
  parseCodeRepositories,
  serializeCodeRepositories,
  type CodeRepositoryRecord
} from '../lib/codeRepositories';

type CodeRepositoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readCodeRepositoriesFromStorage(
  storage: CodeRepositoryStorage | undefined = globalThis.localStorage
): CodeRepositoryRecord[] {
  return parseCodeRepositories(storage?.getItem(CODE_REPOSITORIES_KEY) ?? null);
}

export function writeCodeRepositoriesToStorage(
  records: CodeRepositoryRecord[],
  storage: CodeRepositoryStorage | undefined = globalThis.localStorage
): void {
  storage?.setItem(CODE_REPOSITORIES_KEY, serializeCodeRepositories(records));
}

export function useCodeRepositories(projectId: string) {
  const [records, setRecords] = useState<CodeRepositoryRecord[]>(() => readCodeRepositoriesFromStorage());
  const projectRecords = useMemo(
    () => records.filter((record) => record.projectId === projectId),
    [projectId, records]
  );

  const saveRecords = useCallback((next: CodeRepositoryRecord[]) => {
    setRecords(next);
    writeCodeRepositoriesToStorage(next);
  }, []);

  const upsertRepository = useCallback(
    (record: CodeRepositoryRecord) => {
      saveRecords([record, ...records.filter((item) => item.id !== record.id)]);
    },
    [records, saveRecords]
  );

  return { records: projectRecords, allRecords: records, upsertRepository };
}
