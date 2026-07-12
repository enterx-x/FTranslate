import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import { createRequiredContext } from './createRequiredContext';
import type { AppSidebarSection } from '../components/AppSidebar';
import type { StatusQueueItem } from '../hooks/useStatusQueue';

export type AppView =
  | 'home'
  | 'reader'
  | 'experimentMatrix'
  | 'researchSheet'
  | 'scientificPlot'
  | 'aiAssistant'
  | 'paperTutor'
  | 'knowledgeGraph'
  | 'presentation'
  | 'arxivSearch'
  | 'settings';

export interface UiContextValue {
  view: AppView;
  setView: Dispatch<SetStateAction<AppView>>;
  homeSection: 'hub' | 'library';
  setHomeSection: Dispatch<SetStateAction<'hub' | 'library'>>;
  activeSidebarSection: AppSidebarSection;
  statusMessage: string;
  statusMessages: StatusQueueItem[];
  setStatusMessage: (message: string) => void;
  isReaderSidePanelCollapsed: boolean;
  setIsReaderSidePanelCollapsed: Dispatch<SetStateAction<boolean>>;
  readerSidePanelRatio: number;
  handleReaderSidePanelResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export const [UiProvider, useUiContext] = createRequiredContext<UiContextValue>('UiContext');
