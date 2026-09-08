import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyBriefFeedback, DailyBriefPreferences, DailyBriefSnapshot } from '../../shared/dailyBrief';

export function useDailyBrief() {
  const [snapshot, setSnapshot] = useState<DailyBriefSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const actionLock = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const startRevision = revision.current;
    const unsubscribe = window.electronAPI.onDailyBriefChanged((next) => {
      if (!active) return;
      revision.current += 1;
      setSnapshot(next);
    });
    window.electronAPI.getDailyBriefSnapshot().then((next) => {
      if (active && revision.current === startRevision) setSnapshot(next);
    }).catch((cause) => { if (active) setError(`读取每日简报失败：${String(cause)}`); });
    return () => { active = false; mounted.current = false; unsubscribe(); };
  }, []);

  const perform = useCallback(async (action: () => Promise<DailyBriefSnapshot>) => {
    if (actionLock.current) throw new Error('上一项操作尚未完成，请稍后重试。');
    actionLock.current = true;
    setBusy(true);
    setError('');
    const startRevision = revision.current;
    try {
      const next = await action();
      if (mounted.current && revision.current === startRevision) setSnapshot(next);
    } catch (cause) {
      if (mounted.current) setError(String(cause));
      throw cause;
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return {
    snapshot, error, busy,
    savePreferences: useCallback((preferences: DailyBriefPreferences) => perform(() => window.electronAPI.saveDailyBriefPreferences(preferences)), [perform]),
    run: useCallback(() => perform(() => window.electronAPI.runDailyBrief()), [perform]),
    setFeedback: useCallback((feedback: DailyBriefFeedback) => perform(() => window.electronAPI.setDailyBriefFeedback(feedback)), [perform]),
    removeFeedback: useCallback((id: string) => perform(() => window.electronAPI.removeDailyBriefFeedback(id)), [perform])
  };
}
