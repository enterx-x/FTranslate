import brandMarkUrl from '../assets/brand-mark.png';
import workspaceIcon from '../assets/icons/duotone/workspace.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import libraryIcon from '../assets/icons/duotone/library.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import aiFillIcon from '../assets/icons/duotone/ai-fill.svg';
import analysisIcon from '../assets/icons/duotone/analysis.svg';
import settingsIcon from '../assets/icons/duotone/settings.svg';

export type AppSidebarSection =
  | 'workspace'
  | 'library'
  | 'researchSheet'
  | 'knowledgeGraph'
  | 'reader'
  | 'ai'
  | 'settings';

interface AppSidebarProps {
  activeSection: AppSidebarSection;
  onOpenWorkspace: () => void;
  onOpenLibrary: () => void;
  onOpenResearchSheet: () => void;
  onOpenKnowledgeGraph: () => void;
  onOpenReader: () => void;
  onOpenAi: () => void;
  onOpenSettings: () => void;
}

const navigationItems: Array<{
  section: AppSidebarSection;
  label: string;
  icon: string;
  isUtility?: boolean;
}> = [
  { section: 'workspace', label: '工作台', icon: workspaceIcon },
  { section: 'researchSheet', label: '研究表格', icon: researchSheetIcon },
  { section: 'knowledgeGraph', label: '知识图谱', icon: analysisIcon },
  { section: 'library', label: '论文库', icon: libraryIcon },
  { section: 'reader', label: 'PDF 阅读', icon: pdfReaderIcon },
  { section: 'ai', label: 'AI 助手', icon: aiFillIcon, isUtility: true },
  { section: 'settings', label: '设置', icon: settingsIcon, isUtility: true }
];

export function getSidebarNavigationTarget(section: AppSidebarSection): AppSidebarSection | null {
  return section;
}

export function AppSidebar(props: AppSidebarProps) {
  function handleNavigate(section: AppSidebarSection): void {
    const target = getSidebarNavigationTarget(section);

    if (target === 'workspace') {
      props.onOpenWorkspace();
      return;
    }
    if (target === 'library') {
      props.onOpenLibrary();
      return;
    }
    if (target === 'researchSheet') {
      props.onOpenResearchSheet();
      return;
    }
    if (target === 'knowledgeGraph') {
      props.onOpenKnowledgeGraph();
      return;
    }
    if (target === 'reader') {
      props.onOpenReader();
      return;
    }
    if (target === 'ai') {
      props.onOpenAi();
      return;
    }
    if (target === 'settings') {
      props.onOpenSettings();
    }
  }

  return (
    <aside className="app-sidebar" aria-label="主导航">
      <div className="app-sidebar-brand">
        <img src={brandMarkUrl} alt="" />
        <span>FTranslate</span>
      </div>
      <nav className="app-sidebar-nav">
        {navigationItems.map((item) => (
          <button
            key={item.section}
            type="button"
            className={`app-sidebar-link${props.activeSection === item.section ? ' active' : ''}${item.isUtility ? ' utility' : ''}`}
            onClick={() => handleNavigate(item.section)}
            title={item.label}
          >
            <img className="button-icon" src={item.icon} alt="" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="app-sidebar-footer">
        <span className="app-sidebar-status-dot" />
        <span>本地工作区</span>
      </div>
    </aside>
  );
}
