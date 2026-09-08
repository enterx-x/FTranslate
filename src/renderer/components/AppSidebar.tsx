import { Fragment } from 'react';
import brandMarkUrl from '../assets/brand-mark.png';
import workspaceIcon from '../assets/icons/duotone/workspace.svg';
import libraryIcon from '../assets/icons/duotone/library.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import searchIcon from '../assets/icons/duotone/search.svg';
import settingsIcon from '../assets/icons/duotone/settings.svg';
import styles from '../styles/components/AppSidebar.module.css';

export type AppSidebarSection =
  | 'workspace'
  | 'experimentMatrix'
  | 'library'
  | 'researchSheet'
  | 'knowledgeGraph'
  | 'presentation'
  | 'arxiv'
  | 'reader'
  | 'paperTutor'
  | 'ai'
  | 'settings';

export interface AppSidebarProps {
  activeSection: AppSidebarSection;
  onOpenWorkspace: () => void;
  onOpenExperimentMatrix: () => void;
  onOpenLibrary: () => void;
  onOpenResearchSheet: () => void;
  onOpenKnowledgeGraph: () => void;
  onOpenPresentation: () => void;
  onOpenArxiv: () => void;
  onOpenReader: () => void;
  onOpenPaperTutor: () => void;
  onOpenAi: () => void;
  onOpenSettings: () => void;
}

export interface AppSidebarNavigationItem {
  section: AppSidebarSection;
  label: string;
  icon: string;
  isUtility?: boolean;
  group?: SidebarNavigationGroup;
}

type SidebarNavigationGroup =
  | 'overview'
  | 'reading'
  | 'evidence'
  | 'experiments'
  | 'assistant'
  | 'outputs'
  | 'utility';

const groupLabels: Record<SidebarNavigationGroup, string> = {
  overview: '每日研究',
  reading: '论文与阅读',
  evidence: '方法与证据',
  experiments: '实验与运行',
  assistant: 'AI 研究助手',
  outputs: '组会与导出',
  utility: '应用设置'
};

const groupOrder: SidebarNavigationGroup[] = [
  'overview',
  'reading',
  'evidence',
  'experiments',
  'assistant',
  'outputs',
  'utility'
];

function getSidebarGroup(section: AppSidebarSection): SidebarNavigationGroup {
  if (section === 'workspace') return 'overview';
  if (section === 'library' || section === 'arxiv' || section === 'reader') return 'reading';
  if (section === 'settings') return 'utility';
  if (section === 'knowledgeGraph' || section === 'researchSheet') return 'evidence';
  if (section === 'experimentMatrix') return 'experiments';
  if (section === 'ai' || section === 'paperTutor') return 'assistant';
  return 'outputs';
}

const navigationItems: AppSidebarNavigationItem[] = [
  { section: 'workspace', label: '今日', icon: workspaceIcon },
  { section: 'library', label: '论文库', icon: libraryIcon },
  { section: 'arxiv', label: 'arXiv 检索', icon: searchIcon },
  { section: 'reader', label: 'PDF 阅读', icon: pdfReaderIcon },
  { section: 'settings', label: '设置', icon: settingsIcon, isUtility: true }
];

export function getSidebarNavigationItems(): AppSidebarNavigationItem[] {
  return navigationItems
    .map((item) => ({ ...item, group: getSidebarGroup(item.section) }))
    .sort((left, right) => groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group));
}

export function getSidebarNavigationTarget(section: AppSidebarSection): AppSidebarSection | null {
  return section;
}

export function createSidebarNavigationHandlers(
  props: AppSidebarProps
): Record<AppSidebarSection, () => void> {
  return {
    workspace: props.onOpenWorkspace,
    experimentMatrix: props.onOpenExperimentMatrix,
    library: props.onOpenLibrary,
    researchSheet: props.onOpenResearchSheet,
    knowledgeGraph: props.onOpenKnowledgeGraph,
    presentation: props.onOpenPresentation,
    arxiv: props.onOpenArxiv,
    reader: props.onOpenReader,
    paperTutor: props.onOpenPaperTutor,
    ai: props.onOpenAi,
    settings: props.onOpenSettings
  };
}

export function AppSidebar(props: AppSidebarProps) {
  const navigationHandlers = createSidebarNavigationHandlers(props);
  const groupedItems = getSidebarNavigationItems();

  function handleNavigate(section: AppSidebarSection): void {
    const target = getSidebarNavigationTarget(section);
    target ? navigationHandlers[target]?.() : undefined;
  }

  return (
    <aside className={styles.sidebar} aria-label="主导航">
      <div className={styles.brand}>
        <img src={brandMarkUrl} alt="" />
        <span>FTranslate</span>
      </div>
      <nav className={styles.nav}>
        {groupedItems.map((item, index) => {
          const showGroup = index === 0 || groupedItems[index - 1]?.group !== item.group;
          return (
          <Fragment key={item.section}>
            {showGroup && item.group ? (
              <span className={styles.groupLabel}>{groupLabels[item.group]}</span>
            ) : null}
            <button
            type="button"
            data-sidebar-section={item.section}
            className={[
              'app-sidebar-link',
              styles.link,
              props.activeSection === item.section ? 'active' : '',
              props.activeSection === item.section ? styles.linkActive : '',
              item.isUtility ? 'utility' : '',
              item.isUtility ? styles.linkUtility : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => handleNavigate(item.section)}
            title={item.label}
          >
            <img className={styles.icon} src={item.icon} alt="" />
            <span>{item.label}</span>
          </button>
          </Fragment>
          );
        })}
      </nav>
      <div className={styles.footer}>
        <span className={styles.statusDot} />
        <span>本地工作区</span>
      </div>
    </aside>
  );
}
