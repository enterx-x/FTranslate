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
}

const navigationItems: AppSidebarNavigationItem[] = [
  { section: 'workspace', label: '工作台', icon: workspaceIcon },
  { section: 'researchSheet', label: '研究表格', icon: researchSheetIcon },
  { section: 'knowledgeGraph', label: '知识图谱', icon: analysisIcon },
  { section: 'presentation', label: '组会 PPT', icon: translateIcon },
  { section: 'arxiv', label: 'arXiv 检索', icon: searchIcon },
  { section: 'library', label: '论文库', icon: libraryIcon },
  { section: 'reader', label: 'PDF 阅读', icon: pdfReaderIcon },
  { section: 'paperTutor', label: '论文导师', icon: aiFillIcon, isUtility: true },
  { section: 'ai', label: 'AI 助手', icon: aiFillIcon, isUtility: true },
  { section: 'settings', label: '设置', icon: settingsIcon, isUtility: true }
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
        {navigationItems.map((item) => (
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
            <img className={styles.icon} src={item.icon} alt="" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className={styles.footer}>
        <span className={styles.statusDot} />
        <span>本地工作区</span>
      </div>
    </aside>
  );
}
