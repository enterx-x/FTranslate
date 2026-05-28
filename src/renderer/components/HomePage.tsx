import { useState } from 'react';
import brandMark from '../assets/brand-mark.png';
import type { PaperRecord } from '../lib/papers';

interface HomePageProps {
  papers: PaperRecord[];
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
  { key: 'chineseTitle', label: '中文标题', width: '18%' },
  { key: 'englishTitle', label: '英文标题', width: '22%' },
  { key: 'journal', label: '期刊', width: '10%' },
  { key: 'authors', label: '作者', width: '18%' },
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

  return (
    <main className="home-page">
      <header className="home-header">
        <img className="home-header-mark" src={brandMark} alt="" />
        <div>
          <h1>论文库</h1>
          <p>快速浏览论文主要信息；复杂笔记、创新点和对照分析放到独立研究表格里整理。</p>
        </div>
        <div className="home-header-actions">
          <button type="button" onClick={() => props.onOpenResearchSheet()}>
            研究表格
          </button>
          <button type="button" onClick={props.onNewProject}>
            新建翻译项目
          </button>
        </div>
      </header>

      {props.papers.length === 0 ? (
        <section className="home-empty">
          <h2>还没有论文记录</h2>
          <p>点击“新建翻译项目”，选择 PDF 和翻译文件后会自动加入论文库。</p>
        </section>
      ) : (
        <section className="paper-table-wrap">
          <div className="paper-grid-toolbar">
            <span>
              已收录 <strong>{props.papers.length}</strong> 篇论文
            </span>
            <span>论文库只保留主要信息；点击“研究表格”进入可增删行列和格式化的工作台。</span>
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
                          <span className="paper-cell-text">{visiblePaper[field.key] || '-'}</span>
                        )}
                      </td>
                    ))}
                    <td>
                      <div className="path-hint">PDF：{paper.pdfName}</div>
                      <div className="path-hint">翻译：{paper.translationName}</div>
                      {paper.aiCacheName ? <div className="path-hint">AI 缓存：{paper.aiCacheName}</div> : null}
                      {paper.notes.trim() ? <div className="path-hint">已记录阅读笔记</div> : null}
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
                            <button type="button" onClick={() => props.onOpenPaper(paper)}>
                              打开阅读
                            </button>
                            <button type="button" onClick={() => props.onOpenResearchSheet(paper)}>
                              表格定位
                            </button>
                            <button type="button" onClick={() => startEdit(paper)}>
                              编辑信息
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => props.onRemovePaper(paper)}
                            >
                              移除
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
