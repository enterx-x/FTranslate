import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import {
  PAPER_LIBRARY_VIEW_KEY,
  DEFAULT_PAPER_LIBRARY_PREFERENCES,
  DEFAULT_PAPER_LIBRARY_QUERY,
  applyPaperBulkAction,
  buildPaperLibraryView,
  deleteTagAcrossLibrary,
  getPaperDisplayTitle,
  getPaperProgress,
  getSelectionSummary,
  parsePaperLibraryViewPreferences,
  renameTagAcrossLibrary,
  serializePaperLibraryViewPreferences,
  type PaperLibraryDensity,
  type PaperLibrarySmartView,
  type PaperLibrarySortDirection,
  type PaperLibrarySortKey
} from '../lib/paperLibraryView';
import {
  normalizePaperTags,
  updatePaperRecord,
  type PaperRecord
} from '../lib/papers';
import {
  updateProjectPaperMembership,
  type ResearchProject
} from '../lib/researchProjects';
import styles from './PaperLibraryPage.module.css';

export interface PaperLibraryPageProps {
  papers: PaperRecord[];
  projects: ResearchProject[];
  onBackHome: () => void;
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onOpenResearchSheet: (paper?: PaperRecord) => void;
  onUpdatePapers: (papers: PaperRecord[]) => void;
  onRemovePapers: (paperIds: string[]) => void;
  onProjectsChange: (projects: ResearchProject[]) => void;
}

type InspectorTab = 'overview' | 'notes' | 'relations';
type EditablePaperField = 'chineseTitle' | 'englishTitle' | 'journal' | 'authors' | 'year';

const SORT_OPTIONS: Array<{ key: PaperLibrarySortKey; label: string }> = [
  { key: 'recentActivity', label: '最近活动' },
  { key: 'title', label: '标题' },
  { key: 'year', label: '发表年份' },
  { key: 'importedAt', label: '导入时间' },
  { key: 'lastOpenedAt', label: '最近阅读' },
  { key: 'progress', label: '阅读进度' }
];

const SMART_VIEWS: Array<{ key: Exclude<PaperLibrarySmartView, null>; label: string; icon: string }> = [
  { key: 'recent', label: '最近阅读', icon: '◷' },
  { key: 'needsOrganizing', label: '待整理', icon: '◇' },
  { key: 'pinned', label: '重点论文', icon: '☆' },
  { key: 'completed', label: '已完成', icon: '✓' }
];

const EDITABLE_FIELDS: Array<{ key: EditablePaperField; label: string }> = [
  { key: 'chineseTitle', label: '中文标题' },
  { key: 'englishTitle', label: '英文标题' },
  { key: 'journal', label: '期刊 / 来源' },
  { key: 'authors', label: '作者' },
  { key: 'year', label: '年份' }
];

export function PaperLibraryPage(props: PaperLibraryPageProps) {
  const [preferences, setPreferences] = useState(() =>
    typeof window === 'undefined'
      ? { ...DEFAULT_PAPER_LIBRARY_PREFERENCES }
      : parsePaperLibraryViewPreferences(localStorage.getItem(PAPER_LIBRARY_VIEW_KEY))
  );
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [smartView, setSmartView] = useState<PaperLibrarySmartView>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(
    props.papers[0]?.id ?? null
  );
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [tagInput, setTagInput] = useState('');
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkProjectId, setBulkProjectId] = useState(props.projects[0]?.id ?? '');
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<Partial<PaperRecord>>({});
  const [pendingRemovalIds, setPendingRemovalIds] = useState<string[] | null>(null);
  const [managedTag, setManagedTag] = useState<{ label: string; count: number } | null>(null);
  const [managedTagDraft, setManagedTagDraft] = useState('');
  const [confirmTagDeletion, setConfirmTagDeletion] = useState(false);
  const [pathAvailable, setPathAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSearch(searchInput), 120);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        PAPER_LIBRARY_VIEW_KEY,
        serializePaperLibraryViewPreferences(preferences)
      );
    }
  }, [preferences]);

  const query = useMemo(
    () => ({
      ...DEFAULT_PAPER_LIBRARY_QUERY,
      search,
      activeTags,
      smartView,
      projectId,
      sortKey: preferences.sortKey,
      sortDirection: preferences.sortDirection
    }),
    [activeTags, preferences.sortDirection, preferences.sortKey, projectId, search, smartView]
  );
  const view = useMemo(
    () => buildPaperLibraryView(props.papers, props.projects, query),
    [props.papers, props.projects, query]
  );
  const selectedPaper =
    view.items.find((paper) => paper.id === selectedPaperId) ?? view.items[0] ?? null;
  const selectionSummary = useMemo(
    () => getSelectionSummary(batchSelectedIds, view.items),
    [batchSelectedIds, view.items]
  );

  useEffect(() => {
    if (view.items.length === 0) {
      setSelectedPaperId(null);
      return;
    }
    if (!view.items.some((paper) => paper.id === selectedPaperId)) {
      setSelectedPaperId(view.items[0].id);
    }
  }, [selectedPaperId, view.items]);

  useEffect(() => {
    setEditingMetadata(false);
    setMetadataDraft({});
    setInspectorTab('overview');
  }, [selectedPaper?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedPaper?.pdfPath || typeof window === 'undefined') {
      setPathAvailable(null);
      return () => {
        cancelled = true;
      };
    }

    setPathAvailable(null);
    void window.electronAPI
      .fileExists(selectedPaper.pdfPath)
      .then((exists) => {
        if (!cancelled) {
          setPathAvailable(exists);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPathAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPaper?.id, selectedPaper?.pdfPath]);

  function updatePreferences(
    updates: Partial<{
      sortKey: PaperLibrarySortKey;
      sortDirection: PaperLibrarySortDirection;
      density: PaperLibraryDensity;
      inspectorCollapsed: boolean;
    }>
  ): void {
    setPreferences((current) => ({ ...current, ...updates }));
  }

  function clearFilters(): void {
    setSearchInput('');
    setSearch('');
    setActiveTags([]);
    setSmartView(null);
    setProjectId(null);
  }

  function toggleTag(tag: string): void {
    const key = normalizeTagKey(tag);
    setActiveTags((current) =>
      current.some((item) => normalizeTagKey(item) === key)
        ? current.filter((item) => normalizeTagKey(item) !== key)
        : [...current, tag]
    );
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, paper: PaperRecord): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      props.onOpenPaper(paper);
    }
  }

  function handleBatchCheckbox(
    event: ReactMouseEvent<HTMLInputElement>,
    paperId: string
  ): void {
    event.stopPropagation();
    setBatchSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
  }

  function toggleAllVisible(): void {
    const visibleIds = view.items.map((paper) => paper.id);
    const everyVisibleSelected = visibleIds.every((paperId) => batchSelectedIds.has(paperId));
    setBatchSelectedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((paperId) => {
        if (everyVisibleSelected) {
          next.delete(paperId);
        } else {
          next.add(paperId);
        }
      });
      return next;
    });
  }

  function applyBulkAction(action: Parameters<typeof applyPaperBulkAction>[2]): void {
    const next = applyPaperBulkAction(props.papers, batchSelectedIds, action);
    if (action.type === 'remove') {
      props.onRemovePapers([...batchSelectedIds]);
      setBatchSelectedIds(new Set());
      setPendingRemovalIds(null);
      return;
    }
    props.onUpdatePapers(next);
  }

  function addTagsToSelection(): void {
    const tags = parseTagInput(bulkTagInput);
    if (tags.length === 0) return;
    applyBulkAction({ type: 'addTags', tags });
    setBulkTagInput('');
  }

  function updateSelectedPaper(updates: Parameters<typeof updatePaperRecord>[1]): void {
    if (!selectedPaper) return;
    props.onUpdatePapers([updatePaperRecord(selectedPaper, updates)]);
  }

  function submitSelectedTag(event: FormEvent): void {
    event.preventDefault();
    const tags = parseTagInput(tagInput);
    if (!selectedPaper || tags.length === 0) return;
    updateSelectedPaper({ tags: normalizePaperTags([...selectedPaper.tags, ...tags]) });
    setTagInput('');
  }

  function removeSelectedTag(tag: string): void {
    if (!selectedPaper) return;
    const key = normalizeTagKey(tag);
    updateSelectedPaper({
      tags: selectedPaper.tags.filter((item) => normalizeTagKey(item) !== key)
    });
  }

  function openTagManager(label: string, count: number): void {
    setManagedTag({ label, count });
    setManagedTagDraft(label);
    setConfirmTagDeletion(false);
  }

  function closeTagManager(): void {
    setManagedTag(null);
    setManagedTagDraft('');
    setConfirmTagDeletion(false);
  }

  function renameGlobalTag(): void {
    if (!managedTag) return;
    const [nextTag] = normalizePaperTags([managedTagDraft]);
    if (!nextTag || normalizeTagKey(nextTag) === normalizeTagKey(managedTag.label)) return;
    props.onUpdatePapers(renameTagAcrossLibrary(props.papers, managedTag.label, nextTag));
    setActiveTags((current) => current.map((tag) =>
      normalizeTagKey(tag) === normalizeTagKey(managedTag.label) ? nextTag : tag
    ));
    closeTagManager();
  }

  function deleteGlobalTag(): void {
    if (!managedTag) return;
    props.onUpdatePapers(deleteTagAcrossLibrary(props.papers, managedTag.label));
    setActiveTags((current) =>
      current.filter((item) => normalizeTagKey(item) !== normalizeTagKey(managedTag.label))
    );
    closeTagManager();
  }

  function togglePaperProject(project: ResearchProject, paperId: string): void {
    const isLinked = project.paperIds.includes(paperId);
    props.onProjectsChange(
      updateProjectPaperMembership(
        props.projects,
        project.id,
        [paperId],
        isLinked ? 'remove' : 'add'
      )
    );
  }

  function updateBatchProject(mode: 'add' | 'remove'): void {
    if (!bulkProjectId || batchSelectedIds.size === 0) return;
    props.onProjectsChange(
      updateProjectPaperMembership(
        props.projects,
        bulkProjectId,
        [...batchSelectedIds],
        mode
      )
    );
  }

  function startMetadataEdit(): void {
    if (!selectedPaper) return;
    setMetadataDraft(
      EDITABLE_FIELDS.reduce<Partial<PaperRecord>>((draft, field) => {
        draft[field.key] = selectedPaper[field.key];
        return draft;
      }, {})
    );
    setEditingMetadata(true);
  }

  function saveMetadataEdit(event: FormEvent): void {
    event.preventDefault();
    updateSelectedPaper(metadataDraft);
    setEditingMetadata(false);
  }

  if (props.papers.length === 0) {
    return (
      <main className={styles.page} data-paper-library-page>
        <LibraryToolbar
          paperCount={0}
          searchInput=""
          sortKey={preferences.sortKey}
          sortDirection={preferences.sortDirection}
          density={preferences.density}
          inspectorCollapsed={preferences.inspectorCollapsed}
          onBackHome={props.onBackHome}
          onNewProject={props.onNewProject}
          onSearchChange={() => undefined}
          onSearchKeyDown={() => undefined}
          onSortChange={(sortKey) => updatePreferences({ sortKey })}
          onDirectionChange={() =>
            updatePreferences({
              sortDirection: preferences.sortDirection === 'desc' ? 'asc' : 'desc'
            })
          }
          onDensityChange={() =>
            updatePreferences({
              density: preferences.density === 'compact' ? 'comfortable' : 'compact'
            })
          }
          onInspectorToggle={() =>
            updatePreferences({ inspectorCollapsed: !preferences.inspectorCollapsed })
          }
        />
        <section className={styles.emptyState}>
          <span className={styles.emptyIcon}>▤</span>
          <h2>还没有论文记录</h2>
          <p>导入 PDF 后即可使用标签、项目、排序和阅读进度持续整理研究资料。</p>
          <button type="button" className={styles.primaryButton} onClick={props.onNewProject}>
            导入第一篇论文
          </button>
        </section>
      </main>
    );
  }

  const hasActiveFilters = Boolean(search || activeTags.length || smartView || projectId);
  const allVisibleSelected =
    view.items.length > 0 && view.items.every((paper) => batchSelectedIds.has(paper.id));

  return (
    <main
      className={styles.page}
      data-paper-library-page
      data-density={preferences.density}
    >
      <LibraryToolbar
        paperCount={props.papers.length}
        searchInput={searchInput}
        sortKey={preferences.sortKey}
        sortDirection={preferences.sortDirection}
        density={preferences.density}
        inspectorCollapsed={preferences.inspectorCollapsed}
        onBackHome={props.onBackHome}
        onNewProject={props.onNewProject}
        onSearchChange={setSearchInput}
        onSearchKeyDown={(event) => {
          if (event.key === 'Escape') clearFilters();
        }}
        onSortChange={(sortKey) => updatePreferences({ sortKey })}
        onDirectionChange={() =>
          updatePreferences({
            sortDirection: preferences.sortDirection === 'desc' ? 'asc' : 'desc'
          })
        }
        onDensityChange={() =>
          updatePreferences({
            density: preferences.density === 'compact' ? 'comfortable' : 'compact'
          })
        }
        onInspectorToggle={() =>
          updatePreferences({ inspectorCollapsed: !preferences.inspectorCollapsed })
        }
      />

      <section
        className={`${styles.workspace}${preferences.inspectorCollapsed ? ` ${styles.inspectorIsCollapsed}` : ''}`}
      >
        <aside className={styles.navigator} data-paper-library-navigator>
          <NavigatorSection title="标签" actionLabel="管理">
            <button
              type="button"
              className={`${styles.navItem}${!activeTags.length && !smartView && !projectId ? ` ${styles.navItemActive}` : ''}`}
              onClick={clearFilters}
            >
              <span className={`${styles.tagDot} ${styles.tagTone0}`} />
              <span>全部论文</span>
              <small>{props.papers.length}</small>
            </button>
            {view.tagCatalog.map((tag, index) => (
              <div className={styles.tagNavRow} key={tag.key}>
                <button
                  type="button"
                  className={`${styles.navItem}${activeTags.some((item) => normalizeTagKey(item) === tag.key) ? ` ${styles.navItemActive}` : ''}`}
                  onClick={() => toggleTag(tag.label)}
                >
                  <span className={`${styles.tagDot} ${styles[`tagTone${index % 5}`]}`} />
                  <span title={tag.label}>{tag.label}</span>
                  <small>{tag.count}</small>
                </button>
                <button
                  type="button"
                  className={styles.tagMenuButton}
                  title={`管理标签 ${tag.label}`}
                  aria-label={`管理标签 ${tag.label}`}
                  data-paper-library-tag-manage={tag.key}
                  onClick={() => openTagManager(tag.label, tag.count)}
                >
                  ···
                </button>
              </div>
            ))}
          </NavigatorSection>

          <NavigatorSection title="智能视图">
            {SMART_VIEWS.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`${styles.navItem}${smartView === item.key ? ` ${styles.navItemActive}` : ''}`}
                onClick={() => setSmartView((current) => (current === item.key ? null : item.key))}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
                <small>{countSmartView(props.papers, props.projects, item.key)}</small>
              </button>
            ))}
          </NavigatorSection>

          <NavigatorSection title="项目文件夹">
            {props.projects.map((project) => (
              <button
                type="button"
                key={project.id}
                className={`${styles.navItem}${projectId === project.id ? ` ${styles.navItemActive}` : ''}`}
                onClick={() => setProjectId((current) => (current === project.id ? null : project.id))}
              >
                <span className={styles.navIcon}>▱</span>
                <span title={project.name}>{project.name}</span>
                <small>{project.paperIds.length}</small>
              </button>
            ))}
          </NavigatorSection>
        </aside>

        <section className={styles.libraryPane}>
          <div className={styles.resultBar}>
            <div>
              <strong>{view.items.length}</strong>
              <span> / {props.papers.length} 篇</span>
              {hasActiveFilters ? <span className={styles.filterState}>已筛选</span> : null}
            </div>
            <div className={styles.activeFilters}>
              {activeTags.map((tag) => (
                <button type="button" key={tag} onClick={() => toggleTag(tag)}>
                  {tag} ×
                </button>
              ))}
              {hasActiveFilters ? (
                <button type="button" className={styles.clearButton} onClick={clearFilters}>
                  清除筛选
                </button>
              ) : null}
            </div>
          </div>

          <div className={styles.listHeader}>
            <label className={styles.checkboxCell}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label="选择当前结果"
              />
            </label>
            <span>论文</span>
            <span>标签</span>
            <span>进度</span>
          </div>

          <div className={styles.list} role="listbox" aria-label="论文列表">
            {view.items.length === 0 ? (
              <div className={styles.noResults}>
                <span>没有匹配的论文</span>
                <p>检查搜索词、标签、项目或智能视图。</p>
                <button type="button" onClick={clearFilters}>清除全部筛选</button>
              </div>
            ) : (
              view.items.map((paper) => {
                const progress = getPaperProgress(paper);
                const isSelected = selectedPaper?.id === paper.id;
                const visibleTags = paper.tags.slice(0, 2);
                const extraTagCount = Math.max(0, paper.tags.length - visibleTags.length);
                return (
                  <article
                    key={paper.id}
                    role="option"
                    tabIndex={0}
                    aria-selected={isSelected}
                    className={`${styles.row}${isSelected ? ` ${styles.rowSelected}` : ''}`}
                    data-paper-library-row
                    onClick={() => setSelectedPaperId(paper.id)}
                    onDoubleClick={() => props.onOpenPaper(paper)}
                    onKeyDown={(event) => handleRowKeyDown(event, paper)}
                  >
                    <label className={styles.checkboxCell} onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={batchSelectedIds.has(paper.id)}
                        onClick={(event) => handleBatchCheckbox(event, paper.id)}
                        onChange={() => undefined}
                        aria-label={`选择 ${getPaperDisplayTitle(paper)}`}
                      />
                    </label>
                    <div className={styles.paperCell}>
                      <div className={styles.paperTitleLine}>
                        {paper.isPinned ? <span className={styles.pin} title="已置顶">◆</span> : null}
                        <strong title={getPaperDisplayTitle(paper)}>{getPaperDisplayTitle(paper) || '未命名论文'}</strong>
                      </div>
                      <small title={formatPaperMeta(paper)}>{formatPaperMeta(paper)}</small>
                    </div>
                    <div className={styles.rowTags}>
                      {visibleTags.map((tag, index) => (
                        <span key={tag} className={`${styles.tag} ${styles[`tagTone${tagTone(tag, index)}`]}`}>
                          {tag}
                        </span>
                      ))}
                      {extraTagCount > 0 ? <span className={styles.moreTag}>+{extraTagCount}</span> : null}
                    </div>
                    <div className={styles.progressCell}>
                      {paper.completedAt ? (
                        <span className={styles.completedText}>已完成</span>
                      ) : progress === undefined ? (
                        <span>第 {paper.lastPage} 页</span>
                      ) : (
                        <>
                          <i><span style={{ width: `${Math.round(progress * 100)}%` }} /></i>
                          <span>{Math.round(progress * 100)}%</span>
                        </>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {!preferences.inspectorCollapsed && selectedPaper ? (
          <aside className={styles.inspector} data-paper-library-inspector>
            <div className={styles.inspectorHeader}>
              <div className={styles.documentMark}>PDF</div>
              <div className={styles.inspectorTitle}>
                <h2 title={getPaperDisplayTitle(selectedPaper)}>{getPaperDisplayTitle(selectedPaper)}</h2>
                <p>{formatPaperMeta(selectedPaper)}</p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                title={selectedPaper.isPinned ? '取消置顶' : '置顶论文'}
                onClick={() => updateSelectedPaper({ isPinned: !selectedPaper.isPinned })}
              >
                {selectedPaper.isPinned ? '◆' : '◇'}
              </button>
            </div>

            <ReadingProgress paper={selectedPaper} />
            <button
              type="button"
              className={styles.resumeButton}
              data-paper-library-resume
              disabled={pathAvailable === false}
              onClick={() => props.onOpenPaper(selectedPaper)}
            >
              {pathAvailable === false ? 'PDF 路径失效' : `继续阅读 · 第 ${selectedPaper.lastPage} 页`}
            </button>
            {pathAvailable === false ? (
              <div className={styles.pathWarning}>
                <span>本地 PDF 不存在或已移动。</span>
                <button type="button" onClick={props.onNewProject}>重新定位 / 导入</button>
              </div>
            ) : null}

            <div className={styles.inspectorTabs} role="tablist">
              {(['overview', 'notes', 'relations'] as InspectorTab[]).map((tab) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === tab}
                  key={tab}
                  onClick={() => setInspectorTab(tab)}
                >
                  {tab === 'overview' ? '概览' : tab === 'notes' ? `笔记${selectedPaper.notes ? ' 1' : ''}` : '关联'}
                </button>
              ))}
            </div>

            <div className={styles.inspectorBody}>
              {inspectorTab === 'overview' ? (
                editingMetadata ? (
                  <form className={styles.metadataForm} onSubmit={saveMetadataEdit}>
                    {EDITABLE_FIELDS.map((field) => (
                      <label key={field.key}>
                        <span>{field.label}</span>
                        <input
                          value={String(metadataDraft[field.key] ?? '')}
                          onChange={(event) =>
                            setMetadataDraft((current) => ({
                              ...current,
                              [field.key]: event.target.value
                            }))
                          }
                        />
                      </label>
                    ))}
                    <div className={styles.formActions}>
                      <button type="submit" className={styles.primaryButton}>保存</button>
                      <button type="button" onClick={() => setEditingMetadata(false)}>取消</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <InspectorSection title="标签">
                      <div className={styles.inspectorTags}>
                        {selectedPaper.tags.map((tag, index) => (
                          <span key={tag} className={`${styles.tag} ${styles[`tagTone${tagTone(tag, index)}`]}`}>
                            {tag}
                            <button type="button" onClick={() => removeSelectedTag(tag)} aria-label={`移除标签 ${tag}`}>×</button>
                          </span>
                        ))}
                      </div>
                      <form className={styles.tagInputRow} onSubmit={submitSelectedTag}>
                        <input
                          value={tagInput}
                          list="paper-library-tags"
                          placeholder="添加标签，回车确认"
                          onChange={(event) => setTagInput(event.target.value)}
                        />
                        <button type="submit">添加</button>
                      </form>
                      <datalist id="paper-library-tags">
                        {view.tagCatalog.map((tag) => <option key={tag.key} value={tag.label} />)}
                      </datalist>
                    </InspectorSection>

                    <InspectorSection title="研究项目">
                      <div className={styles.projectLinks}>
                        {props.projects.map((project) => {
                          const linked = project.paperIds.includes(selectedPaper.id);
                          return (
                            <label key={project.id}>
                              <input
                                type="checkbox"
                                checked={linked}
                                onChange={() => togglePaperProject(project, selectedPaper.id)}
                              />
                              <span>{project.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </InspectorSection>

                    <InspectorSection title="本地资产">
                      <ul className={styles.assetList}>
                        <li><span>PDF</span><b>{pathAvailable === false ? '路径失效' : '已索引'}</b></li>
                        <li><span>段落翻译</span><b>{selectedPaper.translationPath ? '可用' : '未生成'}</b></li>
                        <li><span>双语 PDF</span><b>{selectedPaper.translatedPdfPath ? '可用' : '未生成'}</b></li>
                        <li><span>AI 缓存</span><b>{selectedPaper.aiCachePath ? '可用' : '未生成'}</b></li>
                      </ul>
                    </InspectorSection>

                    <InspectorSection title="下一步">
                      <p className={styles.nextStep}>{buildNextStep(selectedPaper)}</p>
                    </InspectorSection>
                  </>
                )
              ) : inspectorTab === 'notes' ? (
                <div className={styles.notesView}>
                  <p>{selectedPaper.notes || '尚未记录阅读笔记。'}</p>
                  <button type="button" onClick={() => props.onOpenResearchSheet(selectedPaper)}>在研究表格中整理</button>
                </div>
              ) : (
                <div className={styles.relationsView}>
                  <InspectorSection title="关联项目">
                    <p>{projectNamesForPaper(props.projects, selectedPaper.id) || '尚未关联研究项目。'}</p>
                  </InspectorSection>
                  <InspectorSection title="研究资产">
                    <p>{countAssets(selectedPaper)} 个可追踪本地资产，可继续写入方法卡、证据图谱和实验矩阵。</p>
                  </InspectorSection>
                </div>
              )}
            </div>

            <div className={styles.inspectorActions}>
              <button type="button" onClick={() => props.onOpenResearchSheet(selectedPaper)}>表格定位</button>
              <button type="button" onClick={startMetadataEdit}>编辑信息</button>
              <button type="button" className={styles.dangerButton} onClick={() => setPendingRemovalIds([selectedPaper.id])}>移除记录</button>
            </div>
          </aside>
        ) : null}
      </section>

      {selectionSummary.total > 0 ? (
        <section className={styles.bulkBar} aria-label="批量操作">
          <div className={styles.bulkSummary}>
            <strong>已选择 {selectionSummary.total} 篇</strong>
            {selectionSummary.hidden > 0 ? <span>{selectionSummary.hidden} 篇不在当前结果</span> : null}
            {selectionSummary.hidden > 0 ? (
              <button
                type="button"
                onClick={() => setBatchSelectedIds(new Set(view.items.map((paper) => paper.id).filter((id) => batchSelectedIds.has(id))))}
              >
                只保留当前结果
              </button>
            ) : null}
          </div>
          <div className={styles.bulkControls}>
            <div className={styles.bulkInputGroup}>
              <input
                value={bulkTagInput}
                placeholder="批量标签"
                onChange={(event) => setBulkTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addTagsToSelection();
                }}
              />
              <button type="button" onClick={addTagsToSelection}>添加</button>
              <button type="button" onClick={() => {
                const tags = parseTagInput(bulkTagInput);
                if (tags.length) applyBulkAction({ type: 'removeTags', tags });
              }}>移除</button>
            </div>
            <div className={styles.bulkInputGroup}>
              <select value={bulkProjectId} onChange={(event) => setBulkProjectId(event.target.value)}>
                {props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <button type="button" onClick={() => updateBatchProject('add')}>加入项目</button>
              <button type="button" onClick={() => updateBatchProject('remove')}>移出</button>
            </div>
            <button type="button" onClick={() => applyBulkAction({ type: 'setPinned', value: true })}>置顶</button>
            <button type="button" onClick={() => applyBulkAction({ type: 'setCompleted', value: true })}>标记完成</button>
            <button type="button" className={styles.dangerButton} onClick={() => setPendingRemovalIds([...batchSelectedIds])}>移除</button>
            <button type="button" className={styles.iconButton} title="清除选择" onClick={() => setBatchSelectedIds(new Set())}>×</button>
          </div>
        </section>
      ) : null}

      {managedTag ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            className={`${styles.confirmDialog} ${styles.tagDialog}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="paper-tag-manager-title"
            data-paper-library-tag-dialog
          >
            <div className={styles.tagDialogHeading}>
              <div>
                <span>标签管理</span>
                <h2 id="paper-tag-manager-title">{managedTag.label}</h2>
              </div>
              <button type="button" className={styles.iconButton} aria-label="关闭标签管理" onClick={closeTagManager}>×</button>
            </div>
            <p>修改会同步到使用该标签的 {managedTag.count} 篇论文，不影响 PDF 和已有研究资产。</p>
            <form className={styles.tagDialogForm} onSubmit={(event) => {
              event.preventDefault();
              renameGlobalTag();
            }}>
              <label htmlFor="paper-tag-name">标签名称</label>
              <input
                id="paper-tag-name"
                value={managedTagDraft}
                maxLength={32}
                autoFocus
                onChange={(event) => {
                  setManagedTagDraft(event.target.value);
                  setConfirmTagDeletion(false);
                }}
              />
              <div className={styles.dialogActions}>
                <button type="button" onClick={closeTagManager}>取消</button>
                <button
                  type="submit"
                  className={styles.primaryDialogAction}
                  disabled={!managedTagDraft.trim() || normalizeTagKey(managedTagDraft) === normalizeTagKey(managedTag.label)}
                >
                  保存重命名
                </button>
              </div>
            </form>
            <div className={styles.tagDeleteZone}>
              {confirmTagDeletion ? (
                <>
                  <p><strong>确认删除“{managedTag.label}”？</strong> 此操作只移除标签，论文仍保留在库中。</p>
                  <div className={styles.dialogActions}>
                    <button type="button" onClick={() => setConfirmTagDeletion(false)}>返回</button>
                    <button type="button" className={styles.dangerPrimary} onClick={deleteGlobalTag}>确认删除标签</button>
                  </div>
                </>
              ) : (
                <button type="button" className={styles.dangerLink} onClick={() => setConfirmTagDeletion(true)}>删除这个标签…</button>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {pendingRemovalIds ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="paper-remove-title">
            <span className={styles.warningIcon}>!</span>
            <h2 id="paper-remove-title">从论文库移除 {pendingRemovalIds.length} 篇论文？</h2>
            <p>只会移除本地论文库记录，不会删除 PDF、翻译文件、AI 缓存或双语 PDF。</p>
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setPendingRemovalIds(null)}>取消</button>
              <button type="button" className={styles.dangerPrimary} onClick={() => {
                props.onRemovePapers(pendingRemovalIds);
                setBatchSelectedIds((current) => {
                  const next = new Set(current);
                  pendingRemovalIds.forEach((id) => next.delete(id));
                  return next;
                });
                setPendingRemovalIds(null);
              }}>确认移除记录</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function LibraryToolbar(props: {
  paperCount: number;
  searchInput: string;
  sortKey: PaperLibrarySortKey;
  sortDirection: PaperLibrarySortDirection;
  density: PaperLibraryDensity;
  inspectorCollapsed: boolean;
  onBackHome: () => void;
  onNewProject: () => void;
  onSearchChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onSortChange: (sortKey: PaperLibrarySortKey) => void;
  onDirectionChange: () => void;
  onDensityChange: () => void;
  onInspectorToggle: () => void;
}) {
  return (
    <header className={styles.toolbar}>
      <button type="button" className={styles.backButton} onClick={props.onBackHome} title="返回项目空间">←</button>
      <div className={styles.pageTitle}>
        <h1>论文库</h1>
        <span>{props.paperCount} 篇论文</span>
      </div>
      <label className={styles.searchBox}>
        <span className={styles.searchIcon} />
        <input
          value={props.searchInput}
          placeholder="搜索标题、作者、标签或笔记..."
          onChange={(event) => props.onSearchChange(event.target.value)}
          onKeyDown={props.onSearchKeyDown}
        />
        {props.searchInput ? <button type="button" onClick={() => props.onSearchChange('')} aria-label="清空搜索">×</button> : <kbd>Ctrl K</kbd>}
      </label>
      <label className={styles.sortControl} data-paper-library-sort>
        <span>排序</span>
        <select value={props.sortKey} onChange={(event) => props.onSortChange(event.target.value as PaperLibrarySortKey)}>
          {SORT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      <button type="button" className={styles.iconButton} onClick={props.onDirectionChange} title={props.sortDirection === 'desc' ? '当前降序' : '当前升序'}>{props.sortDirection === 'desc' ? '↓' : '↑'}</button>
      <button type="button" className={styles.iconButton} onClick={props.onDensityChange} title={`当前${props.density === 'compact' ? '紧凑' : '舒适'}密度`}>{props.density === 'compact' ? '≡' : '☷'}</button>
      <button type="button" className={styles.iconButton} onClick={props.onInspectorToggle} title={props.inspectorCollapsed ? '展开详情' : '折叠详情'}>{props.inspectorCollapsed ? '◧' : '▣'}</button>
      <button type="button" className={styles.primaryButton} onClick={props.onNewProject}>＋ 导入论文</button>
    </header>
  );
}

function NavigatorSection(props: { title: string; actionLabel?: string; children: React.ReactNode }) {
  return (
    <section className={styles.navigatorSection}>
      <header><span>{props.title}</span>{props.actionLabel ? <small>{props.actionLabel}</small> : null}</header>
      {props.children}
    </section>
  );
}

function InspectorSection(props: { title: string; children: React.ReactNode }) {
  return <section className={styles.inspectorSection}><h3>{props.title}</h3>{props.children}</section>;
}

function ReadingProgress({ paper }: { paper: PaperRecord }) {
  const progress = getPaperProgress(paper);
  const percent = progress === undefined ? null : Math.round(progress * 100);
  return (
    <div className={styles.readingProgress}>
      <div><span>阅读进度</span><strong>{paper.completedAt ? '已完成' : percent === null ? `第 ${paper.lastPage} 页` : `${percent}% · 第 ${paper.lastPage} 页`}</strong></div>
      <i>{percent === null ? null : <span style={{ width: `${percent}%` }} />}</i>
    </div>
  );
}

function parseTagInput(value: string): string[] {
  return normalizePaperTags(value.split(/[,，]/gu));
}

function normalizeTagKey(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function formatPaperMeta(paper: PaperRecord): string {
  return [paper.authors, paper.journal, paper.year, formatDate(paper.lastOpenedAt)]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' · ') || '元数据待补充';
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp);
}

function tagTone(tag: string, salt = 0): number {
  let hash = salt;
  for (let index = 0; index < tag.length; index += 1) hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
  return hash % 5;
}

function projectNamesForPaper(projects: ResearchProject[], paperId: string): string {
  return projects.filter((project) => project.paperIds.includes(paperId)).map((project) => project.name).join('、');
}

function countAssets(paper: PaperRecord): number {
  return [paper.pdfPath, paper.translationPath, paper.translatedPdfPath, paper.aiCachePath, paper.notes]
    .filter((value) => Boolean(value?.trim())).length;
}

function buildNextStep(paper: PaperRecord): string {
  if (!paper.tags.length) return '先添加标签，建立可检索的研究主题。';
  if (!paper.notes.trim()) return '继续阅读并沉淀方法、局限与复现判断。';
  if (!paper.translationPath && !paper.translatedPdfPath) return '生成段落翻译或双语 PDF，补齐可复用阅读资产。';
  return '将方法和证据写入研究表格或实验矩阵。';
}

function countSmartView(
  papers: PaperRecord[],
  projects: ResearchProject[],
  smartView: Exclude<PaperLibrarySmartView, null>
): number {
  return buildPaperLibraryView(papers, projects, {
    ...DEFAULT_PAPER_LIBRARY_QUERY,
    smartView
  }).items.length;
}
