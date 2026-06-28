import { memo } from 'react';
import type { StatusQueueItem } from '../hooks/useStatusQueue';
import { useUiContext } from '../contexts/UiContext';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  statusMessage: string;
  statusMessages: StatusQueueItem[];
}

export function getVisibleStatusMessages(
  statusMessage: string,
  statusMessages: StatusQueueItem[]
): StatusQueueItem[] {
  if (statusMessages.length > 0) {
    return statusMessages.slice(-3);
  }

  return statusMessage ? [{ id: 'fallback-status-message', text: statusMessage }] : [];
}

export const StatusBar = memo(function StatusBar(props: StatusBarProps) {
  const visibleMessages = getVisibleStatusMessages(props.statusMessage, props.statusMessages);

  return (
    <footer className={`status-bar ${styles.statusBar}`}>
      <div className={styles.messageStack}>
        {visibleMessages.map((message) => (
          <span className={styles.message} key={message.id}>
            {message.text}
          </span>
        ))}
      </div>
    </footer>
  );
});

export const ConnectedStatusBar = memo(function ConnectedStatusBar() {
  const { statusMessage, statusMessages } = useUiContext();
  return <StatusBar statusMessage={statusMessage} statusMessages={statusMessages} />;
});
