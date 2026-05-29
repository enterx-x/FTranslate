import { useState } from 'react';
import brandMark from '../assets/brand-mark.png';
import translateIcon from '../assets/icons/duotone/translate.svg';
import libraryLineIcon from '../assets/icons/duotone/library.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import backIcon from '../assets/icons/duotone/back.svg';
import deleteIcon from '../assets/icons/duotone/delete.svg';
import type { PaperRecord } from '../lib/papers';

interface HomePageProps {
  papers: PaperRecord[];
  activeSection: 'hub' | 'library';
  onSectionChange: (section: 'hub' | 'library') => void;
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onOpenResearchSheet: (paper?: PaperRecord) => void;
  onUpdatePaper: (paper: PaperRecord) => void;
  onRemovePaper: (paper: PaperRecord) => void;
}

type EditablePaperField =
  | 'chineseTitle'
  | 'englishTitle'
  | 'journal'
  | 'authors'
  | 'year';

const editableFields: Array<{
  key: EditablePaperField;
  label: string;
  width: string;
}> = [
  { key: 'chineseTitle', label: '中文标题', width: '19%' },
  { key: 'englishTitle', label: '英文标题', width: '22%' },
  { key: 'journal', label: '期刊', width: '10%' },
  { key: 'authors', label: '作者', width: '17%' },
  { key: 'year', label: '年份', width: '7%' }
];

export function HomePage(props: HomePageProps) {
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [draftPaper, setDraftPaper] = useState<PaperRecord | null>(null);

  function startEdit(paper: PaperRecord): void {
    setEditingPaperId(paper.id);
    setDraftPaper({ ...paper });
  }

  function cancelEdit(): void {
    setEditingPaperId(null);
    setDraftPaper(null);
  }

  function saveEdit(): void {
    if (!draftPaper) {
      return;
    }

    props.onUpdatePaper(draftPaper);
    cancelEdit();
  }

  function updateDraft(field: EditablePaperField, value: string): void {
    setDraftPaper((paper) => (paper ? { ...paper, [field]: value } : paper));
  }

  if (props.activeSection === 'hub') {
    return (
      <main className="home-page home-hub-page">
        <header className="home-hero">
          <div className="home-hero-brand">
            <img className="home-header-mark" src={brandMark} alt="" />
            <div>
              <span className="eyebrow">FTranslate Workspace</span>
              <h1>论文阅读、PDF 翻译与研究工作台</h1>
              <p>把论文阅读、双语 PDF、研究表格和后续 idea 整合到同一个桌面工具里。</p>
            </div>
          </div>
          <div className="home-header-actions">
            <button type="button" className="primary-button button-with-icon" onClick={props.onNewProject}>
              <img className="button-icon" src={translateIcon} alt="" />
              <span>新建 PDF 翻译</span>
            </button>
          </div>
        </header>

        <section className="home-module-grid" aria-label="功能模块">
          <article className="home-module-card">
            <span className="home-module-kicker">
              <img className="button-icon" src={researchSheetIcon} alt="" />
              Research Sheet
            </span>
            <h2>研究表格</h2>
            <p>像表格软件一样整理创新点、局限、方法、复现计划和后续 idea，支持格式、公式、导入导出和选区级 AI 填写。</p>
            <div className="home-module-meta">
              <span className="badge">独立工作台</span>
              <span className="badge">首行冻结</span>
              <span className="badge">AI 填表</span>
            </div>
            <div className="home-module-actions">
              <button type="button" className="primary-button button-with-icon" onClick={() => props.onOpenResearchSheet()}>
                <img className="button-icon" src={researchSheetIcon} alt="" />
                <span>打开研究表格</span>
              </button>
            </div>
          </article>

          <article className="home-module-card">
            <span className="home-module-kicker">
              <img className="button-icon" src={libraryLineIcon} alt="" />
              Paper Library
            </span>
            <h2>论文库</h2>
            <p>快速浏览已打开论文的标题、作者、期刊、年份、文件状态和最近阅读位置，保持信息轻量清晰。</p>
            <div className="home-module-meta">
              <span className="badge">已收录 {props.papers.length} 篇</span>
              <span className="badge">状态标签</span>
              <span className="badge">一键阅读</span>
            </div>
            <div className="home-module-actions">
              <button type="button" className="primary-button button-with-icon" onClick={() => props.onSectionChange('library')}>
                <img className="button-icon" src={libraryLineIcon} alt="" />
                <span>进入论文库</span>
              </button>
              <button type="button" className="secondary-button button-with-icon" onClick={props.onNewProject}>
                <img className="button-icon" src={translateIcon} alt="" />
                <span>新建项目</span>
              </button>
            </div>
          </article>
        </section>

        <section className="home-overview-panel" aria-label="最近项目和工作台状态">
          <div className="home-overview-head">
            <div>
              <span className="eyebrow">Recent Workspace</span>
              <h2>最近研究进度</h2>
            </div>
            <span className="badge">已收录 {props.papers.length} 篇论文</span>
          </div>
          <div className="home-recent-list">
            {props.papers.slice(0, 3).map((paper) => (
              <button
                key={paper.id}
                type="button"
                className="home-recent-item"
                onClick={() => props.onOpenPaper(paper)}
                title={paper.chineseTitle || paper.englishTitle || paper.pdfName}
              >
                <span>{paper.chineseTitle || paper.englishTitle || paper.pdfName}</span>
                <small>{paper.journal || paper.year || paper.pdfName}</small>
              </button>
            ))}
            {props.papers.length === 0 ? (
              <p className="home-recent-empty">还没有最近项目，可以从“新建 PDF 翻译”开始。</p>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home-page paper-library-page">
      <header className="home-hero paper-library-hero">
        <div className="home-hero-brand">
          <img className="home-header-mark" src={brandMark} alt="" />
          <div>
            <span className="eyebrow">Paper Library</span>
            <h1>论文库</h1>
            <p>浏览论文主要信息；复杂笔记、创新点和对照分析放到独立研究表格里整理。</p>
          </div>
        </div>
        <div className="home-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onSectionChange('hub')}>
            <img className="button-icon" src={backIcon} alt="" />
            <span>返回主页</span>
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={() => props.onOpenResearchSheet()}>
            <img className="button-icon" src={researchSheetIcon} alt="" />
            <span>研究表格</span>
          </button>
          <button type="button" className="primary-button button-with-icon" onClick={props.onNewProject}>
            <img className="button-icon" src={translateIcon} alt="" />
            <span>新建翻译项目</span>
          </button>
        </div>
      </header>

      {props.papers.length === 0 ? (
        <section className="home-empty">
          <img className="empty-state-icon" src={libraryLineIcon} alt="" />
          <h2>还没有论文记录</h2>
          <p>点击“新建翻译项目”选择 PDF 即可加入论文库；手动段落翻译文件可以之后再导入。</p>
        </section>
      ) : (
        <section className="paper-table-wrap">
          <div className="paper-grid-toolbar">
            <span>
              已收录 <strong>{props.papers.length}</strong> 篇论文
            </span>
            <span>PDF、翻译、双语 PDF、笔记和 AI 缓存状态会以标签形式展示。</span>
          </div>
          <table className="paper-table">
            <thead>
              <tr>
                {editableFields.map((field) => (
                  <th key={field.key} style={{ width: field.width }}>
                    {field.label}
                  </th>
                ))}
                <th>文件状态</th>
                <th>最近打开</th>
                <th>页码</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.papers.map((paper) => {
                const isEditing = editingPaperId === paper.id && draftPaper;
                const visiblePaper = isEditing ? draftPaper : paper;

                return (
                  <tr key={paper.id}>
                    {editableFields.map((field) => (
                      <td key={field.key}>
                        {isEditing ? (
                          <input
                            value={visiblePaper[field.key]}
                            onChange={(event) => updateDraft(field.key, event.target.value)}
                          />
                        ) : (
                          <span className={`paper-cell-text ${field.key === 'chineseTitle' ? 'primary-title' : ''}`}>
                            {visiblePaper[field.key] || '-'}
                          </span>
                        )}
                      </td>
                    ))}
                    <td>
                      <div className="paper-status-stack">
                        <span className="badge">PDF</span>
                        {paper.translationName ? <span className="badge">段落翻译</span> : null}
                        {paper.aiCacheName ? <span className="badge">AI 缓存</span> : null}
                        {paper.translatedPdfName ? <span className="badge">双语 PDF</span> : null}
                        {paper.notes.trim() ? <span className="badge">笔记</span> : null}
                      </div>
                      <div className="path-hint">{paper.pdfName}</div>
                    </td>
                    <td>{formatDateTime(paper.lastOpenedAt)}</td>
                    <td>第 {paper.lastPage || 1} 页</td>
                    <td>
                      <div className="table-actions">
                        {isEditing ? (
                          <>
                            <button type="button" className="primary-button" onClick={saveEdit}>
                              保存
                            </button>
                            <button type="button" className="secondary-button" onClick={cancelEdit}>
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="button-with-icon" onClick={() => props.onOpenPaper(paper)}>
                              <img className="button-icon" src={pdfReaderIcon} alt="" />
                              <span>打开阅读</span>
                            </button>
                            <button type="button" className="secondary-button" onClick={() => props.onOpenResearchSheet(paper)}>
                              表格定位
                            </button>
                            <button type="button" className="secondary-button" onClick={() => startEdit(paper)}>
                              编辑信息
                            </button>
                            <button
                              type="button"
                              className="danger-button button-with-icon"
                              onClick={() => props.onRemovePaper(paper)}
                            >
                              <img className="button-icon" src={deleteIcon} alt="" />
                              <span>移除</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
