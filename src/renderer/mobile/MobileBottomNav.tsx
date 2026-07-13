export type MobileView = 'library' | 'search' | 'reader';

interface MobileBottomNavProps {
  view: MobileView;
  readerEnabled: boolean;
  onChange: (view: MobileView) => void;
}

export function MobileBottomNav({ view, readerEnabled, onChange }: MobileBottomNavProps) {
  return (
    <nav className="mobile-bottom-nav" aria-label="移动端主导航">
      <button type="button" className={view === 'library' ? 'active' : ''} onClick={() => onChange('library')}>
        <span aria-hidden="true">▤</span>
        <small>论文库</small>
      </button>
      <button type="button" className={view === 'search' ? 'active' : ''} onClick={() => onChange('search')}>
        <span aria-hidden="true">⌕</span>
        <small>检索</small>
      </button>
      <button
        type="button"
        className={view === 'reader' ? 'active' : ''}
        disabled={!readerEnabled}
        onClick={() => onChange('reader')}
      >
        <span aria-hidden="true">▯</span>
        <small>阅读</small>
      </button>
    </nav>
  );
}
