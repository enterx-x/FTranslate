import { Fragment, useEffect, useState } from 'react';
import brandMarkUrl from '../assets/brand-mark.png';
import workspaceIcon from '../assets/icons/duotone/workspace.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import libraryIcon from '../assets/icons/duotone/library.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import aiFillIcon from '../assets/icons/duotone/ai-fill.svg';
import analysisIcon from '../assets/icons/duotone/analysis.svg';
import searchIcon from '../assets/icons/duotone/search.svg';
import settingsIcon from '../assets/icons/duotone/settings.svg';
import translateIcon from '../assets/icons/duotone/translate.svg';
import styles from '../styles/components/AppSidebar.module.css';

export type AppSidebarSection =
  | 'workspace'
  | 'experimentMatrix'
  | 'library'
  | 'researchSheet'
  | 'plot'
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
  onOpenPlot: () => void;
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
  tier: SidebarNavigationTier;
  group?: SidebarNavigationGroup;
}

export type SidebarNavigationTier = 'core' | 'more' | 'utility';
type SidebarNavigationGroup = 'overview' | 'reading' | 'research';

const groupLabels: Record<SidebarNavigationGroup, string> = {
  overview: '项目',
  reading: '论文工作流',
  research: '实验与分析'
};

const navigationItems: AppSidebarNavigationItem[] = [
  { section: 'workspace', label: '项目空间', icon: workspaceIcon, tier: 'core', group: 'overview' },
  { section: 'arxiv', label: 'arXiv 检索', icon: searchIcon, tier: 'core', group: 'reading' },
  { section: 'library', label: '论文库', icon: libraryIcon, tier: 'core', group: 'reading' },
  { section: 'reader', label: 'PDF 阅读', icon: pdfReaderIcon, tier: 'core', group: 'reading' },
  { section: 'experimentMatrix', label: '实验矩阵', icon: researchSheetIcon, tier: 'core', group: 'research' },
  { section: 'researchSheet', label: '研究表格', icon: researchSheetIcon, tier: 'core', group: 'research' },
  { section: 'plot', label: '科研绘图', icon: analysisIcon, tier: 'core', group: 'research' },
  { section: 'knowledgeGraph', label: '证据图谱', icon: analysisIcon, tier: 'more' },
  { section: 'presentation', label: '组会 PPT', icon: translateIcon, tier: 'more' },
  { section: 'paperTutor', label: '论文导师', icon: aiFillIcon, tier: 'more' },
  { section: 'ai', label: 'AI 助手', icon: aiFillIcon, tier: 'more' },
  { section: 'settings', label: '设置', icon: settingsIcon, tier: 'utility', isUtility: true }
];

export function getSidebarNavigationItems(): AppSidebarNavigationItem[] {
  return navigationItems.map((item) => ({ ...item }));
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
    plot: props.onOpenPlot,
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
  const navigationItems = getSidebarNavigationItems();
  const coreItems = navigationItems.filter((item) => item.tier === 'core');
  const moreItems = navigationItems.filter((item) => item.tier === 'more');
  const utilityItems = navigationItems.filter((item) => item.tier === 'utility');
  const [isMoreOpen, setIsMoreOpen] = useState(() =>
    moreItems.some((item) => item.section === props.activeSection)
  );

  useEffect(() => {
    if (moreItems.some((item) => item.section === props.activeSection)) {
      setIsMoreOpen(true);
    }
  }, [props.activeSection]);

  function handleNavigate(section: AppSidebarSection): void {
    const target = getSidebarNavigationTarget(section);
    target ? navigationHandlers[target]?.() : undefined;
  }

  function renderNavigationButton(item: AppSidebarNavigationItem) {
    return (
      <button
        key={item.section}
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
        <img className={`${styles.icon} app-sidebar-icon`} src={item.icon} alt="" />
        <span>{item.label}</span>
      </button>
    );
  }

  return (
    <aside className={styles.sidebar} aria-label="主导航">
      <div className={styles.brand}>
        <img src={brandMarkUrl} alt="" />
        <span>FTranslate</span>
      </div>
      <nav className={styles.nav}>
        {coreItems.map((item, index) => {
          const showGroup = index === 0 || coreItems[index - 1]?.group !== item.group;
          return (
            <Fragment key={item.section}>
              {showGroup && item.group ? <span className={styles.groupLabel}>{groupLabels[item.group]}</span> : null}
              {renderNavigationButton(item)}
            </Fragment>
          );
        })}
        <div className={styles.moreSection}>
          <button
            type="button"
            className={`${styles.link} ${styles.moreToggle}`}
            data-sidebar-more-toggle
            aria-expanded={isMoreOpen}
            aria-controls="sidebar-more-tools"
            onClick={() => setIsMoreOpen((value) => !value)}
          >
            <span className={styles.moreMarker} aria-hidden="true">•••</span>
            <span>更多工具</span>
            <span className={styles.moreChevron} aria-hidden="true">›</span>
          </button>
          <div id="sidebar-more-tools" className={styles.moreGroup} hidden={!isMoreOpen}>
            {moreItems.map(renderNavigationButton)}
          </div>
        </div>
        <div className={styles.utilityZone}>
          {utilityItems.map(renderNavigationButton)}
        </div>
      </nav>
      <div className={styles.footer}>
        <span className={styles.statusDot} />
        <span>本地工作区</span>
      </div>
    </aside>
  );
}
