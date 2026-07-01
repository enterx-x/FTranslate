import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  summarizeRuntimeCenter,
  type RuntimeCenterSnapshotLike
} from '../lib/runtimeCenter';

export function useRuntimeCenter() {
  const [snapshot, setSnapshot] = useState<RuntimeCenterSnapshotLike | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    const next = await window.electronAPI.getRuntimeCenterSnapshot();
    setSnapshot(next);
  }, []);

  const check = useCallback(async () => {
    setIsChecking(true);
    setError('');
    try {
      setSnapshot(await window.electronAPI.checkRuntimeCenter());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      snapshot,
      summary: snapshot ? summarizeRuntimeCenter(snapshot) : null,
      isChecking,
      error,
      refresh,
      check
    }),
    [check, error, isChecking, refresh, snapshot]
  );
}
