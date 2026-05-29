import brandMarkUrl from '../assets/brand-mark.png';
import workspaceIcon from '../assets/icons/duotone/workspace.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import libraryIcon from '../assets/icons/duotone/library.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import aiFillIcon from '../assets/icons/duotone/ai-fill.svg';
import settingsIcon from '../assets/icons/duotone/settings.svg';

export type AppSidebarSection = 'workspace' | 'library' | 'researchSheet' | 'reader' | 'ai' | 'settings';

interface AppSidebarProps {
  activeSection: AppSidebarSection;
  onOpenWorkspace: () => void;
  onOpenLibrary: () => void;
  onOpenResearchSheet: () => void;
  onOpenReader: () => void;
}

const navigationItems: Array<{
  section: AppSidebarSection;
  label: string;
  icon: string;
  isUtility?: boolean;
}> = [
  { section: 'workspace', label: '工作台', icon: workspaceIcon },
  { section: 'researchSheet', label: '研究表格', icon: researchSheetIcon },
  { section: 'library', label: '论文库', icon: libraryIcon },
  { section: 'reader', label: 'PDF 阅读', icon: pdfReaderIcon },
  { section: 'ai', label: 'AI 助手', icon: aiFillIcon, isUtility: true },
  { section: 'settings', label: '设置', icon: settingsIcon, isUtility: true }
];

export function AppSidebar(props: AppSidebarProps) {
  function handleNavigate(section: AppSidebarSection): void {
    if (section === 'workspace') {
      props.onOpenWorkspace();
      return;
    }
    if (section === 'library') {
      props.onOpenLibrary();
      return;
    }
    if (section === 'researchSheet') {
      props.onOpenResearchSheet();
      return;
    }
    if (section === 'reader' || section === 'ai') {
      props.onOpenReader();
      return;
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
            disabled={item.section === 'settings'}
            title={item.section === 'settings' ? '设置面板后续接入，当前 API 设置在 PDF 阅读页右侧' : item.label}
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
