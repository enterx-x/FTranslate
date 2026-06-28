import { useCallback, useMemo, useRef, useState } from 'react';

export interface StatusQueueItem {
  id: number | string;
  text: string;
}

export function appendStatusMessage(
  queue: StatusQueueItem[],
  message: string,
  id: number,
  maxVisible = 3
): StatusQueueItem[] {
  const text = message.trim();

  if (!text) {
    return queue;
  }

  const visibleLimit = Math.max(1, Math.floor(maxVisible));
  return [...queue, { id, text }].slice(-visibleLimit);
}

export function useStatusQueue(initialMessage: string, maxVisible = 3) {
  const nextIdRef = useRef(1);
  const [statusMessages, setStatusMessages] = useState<StatusQueueItem[]>(() => {
    const text = initialMessage.trim();
    return text ? [{ id: 0, text }] : [];
  });

  const setStatusMessage = useCallback(
    (message: string) => {
      setStatusMessages((current) =>
        appendStatusMessage(current, message, nextIdRef.current++, maxVisible)
      );
    },
    [maxVisible]
  );

  const clearStatusMessages = useCallback(() => {
    setStatusMessages([]);
  }, []);

  const statusMessage = statusMessages.at(-1)?.text ?? '';

  return useMemo(
    () => ({
      statusMessage,
      statusMessages,
      setStatusMessage,
      clearStatusMessages
    }),
    [clearStatusMessages, setStatusMessage, statusMessage, statusMessages]
  );
}
