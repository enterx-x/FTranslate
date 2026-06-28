import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { GenericChatCompletionInput } from '../../shared/aiTranslation';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import type { PaperRecord } from '../lib/papers';
import type { PresentationFigureCandidate } from '../lib/presentationOutline';
import {
  buildPaperTutorPrompt,
  buildPaperTutorSessionTitle,
  buildTutorStarterQuestion,
  collectPaperTutorEvidence,
  createPaperTutorSession,
  prioritizeActivePaperSelection,
  resolvePaperTutorSelection,
  sanitizePaperTutorAnswer,
  trimPaperTutorSessionsForStorage,
  type PaperTutorEvidenceStoreEntry,
  type PaperTutorMessage,
  type PaperTutorSession
} from '../lib/paperTutor';
import aiFillIcon from '../assets/icons/duotone/ai-fill.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import searchIcon from '../assets/icons/duotone/search.svg';
import { InsightMarkdown } from './InsightMarkdown';

const PAPER_TUTOR_SELECTION_KEY = 'pdfTranslationReader:paperTutorSelectedPaperIds';
const PAPER_TUTOR_MESSAGES_KEY = 'pdfTranslationReader:paperTutorMessages';
const PAPER_TUTOR_SESSIONS_KEY = 'pdfTranslationReader:paperTutorSessions';
const PAPER_TUTOR_CONTEXT_RAIL_COLLAPSED_KEY = 'pdfTranslationReader:paperTutorContextRailCollapsed';
const PAPER_TUTOR_EVIDENCE_RAIL_COLLAPSED_KEY = 'pdfTranslationReader:paperTutorEvidenceRailCollapsed';
const PAPER_TUTOR_MAX_PAPERS = 5;

interface PaperTutorPageProps {
  papers: PaperRecord[];
  activePaperId: string | null;
  figures: PresentationFigureCandidate[];
  pdfBlocks: ExtractedPdfBlock[];
  evidenceByPaperId: Record<string, PaperTutorEvidenceStoreEntry>;
  isBusy: boolean;
  onBackHome: () => void;
  onOpenReader: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onPaperTutorChat: (request: GenericChatCompletionInput) => Promise<string>;
}

export function PaperTutorPage(props: PaperTutorPageProps) {
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>(() => {
    const storedIds = readStoredStringArray(PAPER_TUTOR_SELECTION_KEY).slice(0, PAPER_TUTOR_MAX_PAPERS);
    const initialSelection = prioritizeActivePaperSelection(
      storedIds,
      props.activePaperId,
      props.papers,
      PAPER_TUTOR_MAX_PAPERS
    );
    if (initialSelection.length > 0) {
      return initialSelection;
    }
    if (props.activePaperId) {
      return [props.activePaperId];
    }
    return props.papers[0]?.id ? [props.papers[0].id] : [];
  });
  const [paperQuery, setPaperQuery] = useState('');
  const [sessions, setSessions] = useState<PaperTutorSession[]>(() => {
    const stored = readStoredTutorSessions();
    if (stored.length > 0) {
      return stored;
    }

    const initialPapers = resolvePaperTutorSelection(props.papers, selectedPaperIds, props.activePaperId);
    return [createPaperTutorSession({ papers: initialPapers })];
  });
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id ?? '');
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [expandedFigureId, setExpandedFigureId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState('');
  const [isContextRailCollapsed, setIsContextRailCollapsed] = useState(
    () => localStorage.getItem(PAPER_TUTOR_CONTEXT_RAIL_COLLAPSED_KEY) === '1'
  );
  const [isEvidenceRailCollapsed, setIsEvidenceRailCollapsed] = useState(
    () => localStorage.getItem(PAPER_TUTOR_EVIDENCE_RAIL_COLLAPSED_KEY) === '1'
  );
  const lastActivePaperIdRef = useRef<string | null>(props.activePaperId);

  const searchablePapers = useMemo(() => {
    const query = paperQuery.trim().toLowerCase();
    if (!query) {
      return props.papers.slice(0, 60);
    }

    return props.papers
      .filter((paper) =>
        [
          paper.chineseTitle,
          paper.englishTitle,
          paper.pdfName,
          paper.authors,
          paper.notes
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 60);
  }, [paperQuery, props.papers]);

  const selectedPapers = useMemo(
    () => resolvePaperTutorSelection(props.papers, selectedPaperIds, props.activePaperId),
    [props.activePaperId, props.papers, selectedPaperIds]
  );
  const selectionLimitReached = selectedPaperIds.length >= PAPER_TUTOR_MAX_PAPERS;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const messages = activeSession?.messages ?? [];

  const pdfTextSnippets = useMemo(
    () =>
      props.pdfBlocks
        .filter((block) => block.original.trim())
        .slice(0, 12)
        .map((block) => `p.${block.page} ${block.section ? `[${block.section}] ` : ''}${block.original}`),
    [props.pdfBlocks]
  );
  const tutorEvidence = useMemo(
    () =>
      collectPaperTutorEvidence({
        papers: props.papers,
        selectedPaperIds,
        activePaperId: props.activePaperId,
        activeFigures: props.figures,
        activePdfTextSnippets: pdfTextSnippets,
        evidenceByPaperId: props.evidenceByPaperId
      }),
    [pdfTextSnippets, props.activePaperId, props.evidenceByPaperId, props.figures, props.papers, selectedPaperIds]
  );
  const expandedFigure = useMemo(() => {
    if (!expandedFigureId) {
      return null;
    }
    for (const bundle of tutorEvidence.bundles) {
      const figure = bundle.figures.find(
        (candidate) => makeTutorFigureKey(bundle.paperId, candidate.imageId) === expandedFigureId
      );
      if (figure) {
        return { figure, paperTitle: bundle.paperTitle };
      }
    }
    return null;
  }, [expandedFigureId, tutorEvidence.bundles]);

  useEffect(() => {
    const validIds = new Set(props.papers.map((paper) => paper.id));
    const nextIds = selectedPaperIds.filter((id) => validIds.has(id));
    if (nextIds.length !== selectedPaperIds.length) {
      setSelectedPaperIds(nextIds);
      return;
    }

    if (selectedPaperIds.length === 0) {
      const fallbackPaperId =
        props.activePaperId && validIds.has(props.activePaperId)
          ? props.activePaperId
          : props.papers[0]?.id;
      if (fallbackPaperId) {
        setSelectedPaperIds([fallbackPaperId]);
      }
    }
  }, [props.activePaperId, props.papers, selectedPaperIds]);

  useEffect(() => {
    const activePaperId = props.activePaperId;
    if (lastActivePaperIdRef.current === activePaperId) {
      return;
    }
    lastActivePaperIdRef.current = activePaperId;
    if (!activePaperId) {
      return;
    }
    setSelectedPaperIds((current) =>
      prioritizeActivePaperSelection(current, activePaperId, props.papers, PAPER_TUTOR_MAX_PAPERS)
    );
  }, [props.activePaperId, props.papers]);

  useEffect(() => {
    localStorage.setItem(PAPER_TUTOR_SELECTION_KEY, JSON.stringify(selectedPaperIds.slice(0, PAPER_TUTOR_MAX_PAPERS)));
  }, [selectedPaperIds]);

  useEffect(() => {
    localStorage.setItem(PAPER_TUTOR_SESSIONS_KEY, JSON.stringify(trimPaperTutorSessionsForStorage(sessions)));
  }, [sessions]);

  useEffect(() => {
    if (sessions.length === 0) {
      const initialPapers = resolvePaperTutorSelection(props.papers, selectedPaperIds, props.activePaperId);
      const session = createPaperTutorSession({ papers: initialPapers });
      setSessions([session]);
      setActiveSessionId(session.id);
      return;
    }

    if (!activeSessionId || !sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, props.activePaperId, props.papers, selectedPaperIds, sessions]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    setSessions((current) =>
      current.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              title: session.manualTitle ? session.title : buildPaperTutorSessionTitle(selectedPapers),
              paperIds: selectedPaperIds.slice(0, PAPER_TUTOR_MAX_PAPERS),
              updatedAt: new Date().toISOString()
            }
          : session
      )
    );
  }, [activeSessionId, selectedPaperIds, selectedPapers]);

  function togglePaperSelection(paperId: string): void {
    setSelectedPaperIds((current) =>
      current.includes(paperId)
        ? current.filter((id) => id !== paperId)
        : current.length >= PAPER_TUTOR_MAX_PAPERS
          ? current
          : [...current, paperId]
    );
  }

  async function sendMessage(message: string, showUserMessage = true): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed || selectedPapers.length === 0 || isRunning || props.isBusy) {
      return;
    }

    const requestSessionId = activeSessionId;
    const requestPapers = selectedPapers;
    const requestEvidence = tutorEvidence;
    const visibleHistory: PaperTutorMessage[] = showUserMessage
      ? [...messages, { role: 'user', content: trimmed }]
      : messages;
    replaceSessionMessages(requestSessionId, visibleHistory);
    setInput('');
    setIsRunning(true);

    try {
      const prompt = buildPaperTutorPrompt({
        papers: requestPapers,
        figures: requestEvidence.figures,
        evidenceBundles: requestEvidence.bundles,
        pdfTextSnippets: requestEvidence.pdfTextSnippets,
        history: visibleHistory,
        userMessage: trimmed
      });
      const answer = sanitizePaperTutorAnswer(await props.onPaperTutorChat(prompt));
      replaceSessionMessages(requestSessionId, [
        ...visibleHistory,
        {
          role: 'assistant',
          content: answer || 'AI 没有返回导师反馈，请检查 API 配置或稍后重试。'
        }
      ]);
    } catch (error) {
      replaceSessionMessages(requestSessionId, [
        ...visibleHistory,
        {
          role: 'assistant',
          content: `导师问答失败：${String(error)}`
        }
      ]);
    } finally {
      setIsRunning(false);
    }
  }

  function replaceActiveSessionMessages(nextMessages: PaperTutorMessage[]): void {
    replaceSessionMessages(activeSessionId, nextMessages);
  }

  function replaceSessionMessages(sessionId: string, nextMessages: PaperTutorMessage[]): void {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: nextMessages.slice(-30),
              updatedAt: new Date().toISOString()
            }
          : session
      )
    );
  }

  function createSessionFromSelection(): void {
    const session = createPaperTutorSession({ papers: selectedPapers });
    setSessions((current) => trimPaperTutorSessionsForStorage([session, ...current]));
    setActiveSessionId(session.id);
  }

  function activateSession(session: PaperTutorSession): void {
    setActiveSessionId(session.id);
    setSelectedPaperIds(session.paperIds.slice(0, PAPER_TUTOR_MAX_PAPERS));
  }

  function startRenameSession(session: PaperTutorSession): void {
    setRenamingSessionId(session.id);
    setSessionNameDraft(session.title);
  }

  function saveSessionName(): void {
    const nextName = sessionNameDraft.trim();
    if (!renamingSessionId || !nextName) {
      setRenamingSessionId(null);
      return;
    }

    setSessions((current) =>
      current.map((session) =>
        session.id === renamingSessionId
          ? { ...session, title: nextName.slice(0, 60), manualTitle: true, updatedAt: new Date().toISOString() }
          : session
      )
    );
    setRenamingSessionId(null);
    setSessionNameDraft('');
  }

  function deleteSession(session: PaperTutorSession): void {
    if (!window.confirm(`确认删除问答窗口“${session.title}”？该窗口的消息历史会被删除。`)) {
      return;
    }

    const remaining = sessions.filter((item) => item.id !== session.id);
    const nextSessions = remaining.length > 0 ? remaining : [createPaperTutorSession({ papers: selectedPapers })];
    setSessions(nextSessions);
    if (activeSessionId === session.id) {
      setActiveSessionId(nextSessions[0].id);
      setSelectedPaperIds(nextSessions[0].paperIds.slice(0, PAPER_TUTOR_MAX_PAPERS));
    }
  }

  function clearActiveSessionMessages(): void {
    const title = activeSession?.title || '当前问答窗口';
    if (!window.confirm(`确认清空“${title}”的全部消息？论文选择和窗口名称会保留。`)) {
      return;
    }

    replaceActiveSessionMessages([]);
  }

  function toggleContextRail(): void {
    setIsContextRailCollapsed((value) => {
      const nextValue = !value;
      localStorage.setItem(PAPER_TUTOR_CONTEXT_RAIL_COLLAPSED_KEY, nextValue ? '1' : '0');
      return nextValue;
    });
  }

  function toggleEvidenceRail(): void {
    setIsEvidenceRailCollapsed((value) => {
      const nextValue = !value;
      localStorage.setItem(PAPER_TUTOR_EVIDENCE_RAIL_COLLAPSED_KEY, nextValue ? '1' : '0');
      return nextValue;
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <main className="paper-tutor-page" data-page="paper-tutor">
      <header className="paper-tutor-topbar">
        <div>
          <span className="eyebrow">Paper Tutor Chat</span>
          <h1>
            <img className="panel-title-icon" src={aiFillIcon} alt="" />
            <span>论文导师问答</span>
          </h1>
          <p>像组会导师一样围绕论文方法、图表、实验和多论文差异持续追问。</p>
        </div>
        <div className="paper-tutor-topbar-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={props.onOpenReader}>
            <img className="button-icon" src={pdfReaderIcon} alt="" />
            <span>打开阅读器</span>
          </button>
          <button type="button" className="secondary-button" onClick={props.onBackHome}>
            返回工作台
          </button>
        </div>
      </header>

      <div
        className={`paper-tutor-layout${isContextRailCollapsed ? ' is-paper-rail-collapsed' : ''}${
          isEvidenceRailCollapsed ? ' is-evidence-rail-collapsed' : ''
        }`}
      >
        <aside
          className={`paper-tutor-rail paper-tutor-paper-rail${isContextRailCollapsed ? ' is-collapsed' : ''}`}
          aria-label="选择论文"
        >
          <div className="paper-tutor-rail-header">
            <strong>论文上下文</strong>
            <span>{selectedPapers.length} / 5</span>
            <button
              type="button"
              className="paper-tutor-rail-toggle"
              aria-expanded={!isContextRailCollapsed}
              title={isContextRailCollapsed ? '展开论文上下文' : '收起论文上下文'}
              onClick={toggleContextRail}
            >
              {isContextRailCollapsed ? '展开' : '收起'}
            </button>
          </div>
          {!isContextRailCollapsed ? (
            <>
              <label className="paper-tutor-search">
                <img className="button-icon" src={searchIcon} alt="" />
                <input
                  value={paperQuery}
                  placeholder="搜索论文库"
                  onChange={(event) => setPaperQuery(event.target.value)}
                />
              </label>
              <div className="paper-tutor-paper-list">
                <div className="paper-tutor-session-list" aria-label="导师问答窗口">
                  <div className="paper-tutor-session-list-head">
                    <strong>问答窗口</strong>
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      aria-label="新建导师问答窗口"
                      onClick={createSessionFromSelection}
                    >
                      新窗口
                    </button>
                  </div>
                  {sessions.map((session) => (
                    <article
                      key={session.id}
                      className={`paper-tutor-session-item${session.id === activeSessionId ? ' active' : ''}`}
                    >
                      {renamingSessionId === session.id ? (
                        <label className="paper-tutor-session-rename">
                          <span>窗口名称</span>
                          <input
                            value={sessionNameDraft}
                            autoFocus
                            maxLength={60}
                            onChange={(event) => setSessionNameDraft(event.target.value)}
                            onBlur={saveSessionName}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                saveSessionName();
                              }
                              if (event.key === 'Escape') {
                                setRenamingSessionId(null);
                                setSessionNameDraft('');
                              }
                            }}
                          />
                        </label>
                      ) : (
                        <>
                          <button type="button" className="paper-tutor-session-main" onClick={() => activateSession(session)} title={session.title}>
                            <span>{session.title}</span>
                            <small>{session.messages.length} 条 · {session.paperIds.length} 篇</small>
                          </button>
                          <div className="paper-tutor-session-actions">
                            <button type="button" className="paper-tutor-session-rename-button" onClick={() => startRenameSession(session)}>
                              命名
                            </button>
                            <button
                              type="button"
                              className="paper-tutor-session-rename-button danger"
                              onClick={() => deleteSession(session)}
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
                {searchablePapers.length > 0 ? (
                  searchablePapers.map((paper) => (
                    <label key={paper.id} className="paper-tutor-paper-item">
                      <input
                        type="checkbox"
                        checked={selectedPaperIds.includes(paper.id)}
                        disabled={!selectedPaperIds.includes(paper.id) && selectionLimitReached}
                        onChange={() => togglePaperSelection(paper.id)}
                      />
                      <span>{paper.chineseTitle || paper.englishTitle || paper.pdfName}</span>
                    </label>
                  ))
                ) : (
                  <p className="empty-hint">论文库中没有匹配结果。</p>
                )}
              </div>
            </>
          ) : null}
        </aside>

        <section className="paper-tutor-chat-shell" aria-label="论文导师聊天">
          <div className="paper-tutor-chat-header">
            <div>
              <strong>组会式追问</strong>
              <p>
                {selectedPapers.length > 1
                  ? `正在比较 ${selectedPapers.length} 篇论文的方法差异`
                  : selectedPapers[0]
                    ? `当前论文：${selectedPapers[0].chineseTitle || selectedPapers[0].englishTitle || selectedPapers[0].pdfName}`
                    : '请选择至少一篇论文'}
              </p>
            </div>
            <div className="paper-tutor-quick-actions">
              {selectedPapers[0] ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => props.onOpenPaper(selectedPapers[0])}
                >
                  打开论文
                </button>
              ) : null}
              <button
                type="button"
                className="secondary-button"
                disabled={selectedPapers.length === 0 || isRunning || props.isBusy}
                onClick={() =>
                  void sendMessage(
                    `请先提出第一个问题。参考起点：${buildTutorStarterQuestion(selectedPapers, tutorEvidence.figures)}`,
                    false
                  )
                }
              >
                开始提问
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={selectedPapers.length === 0 || isRunning || props.isBusy}
                onClick={() => void sendMessage('我不会，请先给出解答，然后问一个更小的问题。')}
              >
                我不会
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={messages.length === 0 || isRunning}
                onClick={clearActiveSessionMessages}
              >
                清空
              </button>
            </div>
          </div>

          <div className="paper-tutor-messages" aria-live="polite">
            {messages.length > 0 ? (
              messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`paper-tutor-message ${message.role}`}>
                  <strong>{message.role === 'assistant' ? '导师' : '我'}</strong>
                  <InsightMarkdown text={message.content} />
                </article>
              ))
            ) : (
              <div className="paper-tutor-empty-state">
                <strong>先让导师问第一个问题</strong>
                <p>AI 会根据选中论文和提取图表，追问输入、输出、模型变换、损失函数、实验指标和论文差异。</p>
                <div className="paper-tutor-suggestions">
                  <button
                    type="button"
                    onClick={() =>
                      setInput('请像组会导师一样问我第一个问题，重点检查我是否理解这篇论文的方法输入、输出和模型变换。')
                    }
                  >
                    方法主线
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('请基于提取的图片追问我这篇论文的模块结构和实验图说明。')}
                  >
                    图表讲解
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('请比较我选中的几篇论文，问我它们的方法差异和实验差异。')}
                  >
                    多论文对比
                  </button>
                </div>
              </div>
            )}
            {isRunning ? <p className="paper-tutor-thinking">导师正在组织问题...</p> : null}
          </div>

          <div className="paper-tutor-composer">
            <textarea
              value={input}
              rows={3}
              placeholder="输入你的回答或追问。Enter 发送，Shift+Enter 换行。"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <button
              type="button"
              className="primary-button"
              disabled={!input.trim() || selectedPapers.length === 0 || isRunning || props.isBusy}
              onClick={() => void sendMessage(input)}
            >
              发送
            </button>
          </div>
        </section>

        <aside
          className={`paper-tutor-rail paper-tutor-evidence-rail${isEvidenceRailCollapsed ? ' is-collapsed' : ''}`}
          aria-label="图表和文本证据"
        >
          <div className="paper-tutor-rail-header">
            <strong>图表证据</strong>
            <span>{tutorEvidence.figures.length}</span>
            <button
              type="button"
              className="paper-tutor-rail-toggle"
              aria-expanded={!isEvidenceRailCollapsed}
              title={isEvidenceRailCollapsed ? '展开图表证据' : '收起图表证据'}
              onClick={toggleEvidenceRail}
            >
              {isEvidenceRailCollapsed ? '展开' : '收起'}
            </button>
          </div>
          {!isEvidenceRailCollapsed ? (
            <div className="paper-tutor-evidence-scroll">
              <div className="paper-tutor-figure-strip">
                {tutorEvidence.bundles.some((bundle) => bundle.figures.length > 0) ? (
                  tutorEvidence.bundles.map((bundle) =>
                    bundle.figures.length > 0 ? (
                      <section key={bundle.paperId} className="paper-tutor-evidence-group">
                        <strong title={bundle.paperTitle}>{bundle.paperTitle}</strong>
                        {bundle.figures.slice(0, 10).map((figure) => {
                          const figureKey = makeTutorFigureKey(bundle.paperId, figure.imageId);
                          return (
                            <article key={figureKey}>
                              {figure.imageDataUrl ? (
                                <button
                                  type="button"
                                  className="paper-tutor-figure-preview"
                                  onClick={() => setExpandedFigureId(figureKey)}
                                  title="点击放大图表"
                                >
                                  <img src={figure.imageDataUrl} alt={figure.caption} />
                                </button>
                              ) : null}
                              <span>第 {figure.pageNumber} 页 · {figure.figureKind ?? 'figure'}</span>
                              <small>{figure.caption}</small>
                            </article>
                          );
                        })}
                      </section>
                    ) : null
                  )
                ) : (
                  <p className="empty-hint">当前没有提取图表。可在 PDF 阅读页点击“提取文献图片”。</p>
                )}
              </div>
              <div className="paper-tutor-text-snippets">
                <strong>PDF 文本片段</strong>
                {tutorEvidence.bundles.some((bundle) => bundle.pdfTextSnippets.length > 0) ? (
                  tutorEvidence.bundles.map((bundle) =>
                    bundle.pdfTextSnippets.length > 0 ? (
                      <section key={`${bundle.paperId}-text`} className="paper-tutor-evidence-group">
                        <strong title={bundle.paperTitle}>{bundle.paperTitle}</strong>
                        {bundle.pdfTextSnippets.slice(0, 4).map((snippet, index) => (
                          <p key={`${bundle.paperId}-${snippet.slice(0, 24)}-${index}`}>{snippet}</p>
                        ))}
                      </section>
                    ) : null
                  )
                ) : (
                  <p className="empty-hint">当前没有可用 PDF 文本片段。</p>
                )}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      {expandedFigure ? (
        <div className="paper-tutor-figure-lightbox" role="dialog" aria-modal="true" aria-label="放大图表">
          <button
            type="button"
            className="paper-tutor-figure-lightbox-backdrop"
            aria-label="关闭图表预览"
            onClick={() => setExpandedFigureId(null)}
          />
          <article className="paper-tutor-figure-lightbox-panel">
            <div className="paper-tutor-figure-lightbox-header">
              <strong>{expandedFigure.paperTitle} · 第 {expandedFigure.figure.pageNumber} 页 · {expandedFigure.figure.figureKind ?? 'figure'}</strong>
              <button type="button" className="secondary-button" onClick={() => setExpandedFigureId(null)}>
                关闭
              </button>
            </div>
            {expandedFigure.figure.imageDataUrl ? <img src={expandedFigure.figure.imageDataUrl} alt={expandedFigure.figure.caption} /> : null}
            <p>{expandedFigure.figure.caption}</p>
          </article>
        </div>
      ) : null}
    </main>
  );
}

function makeTutorFigureKey(paperId: string, imageId: string): string {
  return `${paperId}::${imageId}`;
}

function readStoredStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function readStoredTutorMessages(): PaperTutorMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PAPER_TUTOR_MESSAGES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is PaperTutorMessage =>
        Boolean(item) &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0
      )
      .slice(-30);
  } catch {
    return [];
  }
}

function readStoredTutorSessions(): PaperTutorSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PAPER_TUTOR_SESSIONS_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      const sessions = parsed
        .filter((item): item is PaperTutorSession =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          Array.isArray(item.paperIds) &&
          Array.isArray(item.messages)
        )
        .map((item) => ({
          ...item,
          paperIds: item.paperIds.filter((paperId) => typeof paperId === 'string').slice(0, PAPER_TUTOR_MAX_PAPERS),
          messages: item.messages
            .filter((message): message is PaperTutorMessage =>
              Boolean(message) &&
              (message.role === 'user' || message.role === 'assistant') &&
              typeof message.content === 'string' &&
              message.content.trim().length > 0
            )
            .slice(-30)
        }));
      if (sessions.length > 0) {
        return trimPaperTutorSessionsForStorage(sessions);
      }
    }
  } catch {
    // Fall through to legacy message migration.
  }

  const legacyMessages = readStoredTutorMessages();
  return legacyMessages.length > 0
    ? [
        {
          id: `paper-tutor-legacy-${Date.now()}`,
          title: '旧版问答窗口',
          paperIds: [],
          messages: legacyMessages,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          manualTitle: true
        }
      ]
    : [];
}
