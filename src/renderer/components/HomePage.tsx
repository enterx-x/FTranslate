import { useState } from 'react';
import type { PaperRecord } from '../lib/papers';

interface HomePageProps {
  papers: PaperRecord[];
  onNewProject: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onUpdatePaper: (paper: PaperRecord) => void;
  onRemovePaper: (paper: PaperRecord) => void;
}

type EditablePaperFields = Pick<
  PaperRecord,
  'chineseTitle' | 'englishTitle' | 'journal' | 'authors' | 'year'
>;

export function HomePage(props: HomePageProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditablePaperFields | null>(null);

  function startEdit(paper: PaperRecord): void {
    setEditingId(paper.id);
    setDraft({
      chineseTitle: paper.chineseTitle,
      englishTitle: paper.englishTitle,
      journal: paper.journal,
      authors: paper.authors,
      year: paper.year
    });
  }

  function applyEdit(paper: PaperRecord): void {
    if (!draft) {
      return;
    }

    props.onUpdatePaper({
      ...paper,
      ...draft
    });
    setEditingId(null);
    setDraft(null);
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <div>
          <h1>论文库</h1>
          <p>管理已打开的 PDF 与翻译文件，后续可直接从这里继续阅读。</p>
        </div>
        <button type="button" onClick={props.onNewProject}>
          新建翻译项目
        </button>
      </header>

      {props.papers.length === 0 ? (
        <section className="home-empty">
          <h2>还没有论文记录</h2>
          <p>点击“新建翻译项目”，选择 PDF 和翻译文件后会自动加入论文库。</p>
        </section>
      ) : (
        <section className="paper-table-wrap">
          <table className="paper-table">
            <thead>
              <tr>
                <th>中文标题</th>
                <th>英文标题</th>
                <th>期刊</th>
                <th>作者</th>
                <th>年份</th>
                <th>最近打开</th>
                <th>页码</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.papers.map((paper) => {
                const isEditing = editingId === paper.id;
                return (
                  <tr key={paper.id}>
                    <td>
                      {isEditing ? (
                        <input
                          value={draft?.chineseTitle ?? ''}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...createDraft(value, paper),
                              chineseTitle: event.target.value
                            }))
                          }
                        />
                      ) : (
                        <strong>{paper.chineseTitle || '未填写'}</strong>
                      )}
                      <div className="path-hint">{paper.translationName}</div>
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          value={draft?.englishTitle ?? ''}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...createDraft(value, paper),
                              englishTitle: event.target.value
                            }))
                          }
                        />
                      ) : (
                        paper.englishTitle || '未填写'
                      )}
                      <div className="path-hint">{paper.pdfName}</div>
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          value={draft?.journal ?? ''}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...createDraft(value, paper),
                              journal: event.target.value
                            }))
                          }
                        />
                      ) : (
                        paper.journal || '-'
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          value={draft?.authors ?? ''}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...createDraft(value, paper),
                              authors: event.target.value
                            }))
                          }
                        />
                      ) : (
                        paper.authors || '-'
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          value={draft?.year ?? ''}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...createDraft(value, paper),
                              year: event.target.value
                            }))
                          }
                        />
                      ) : (
                        paper.year || '-'
                      )}
                    </td>
                    <td>{formatDateTime(paper.lastOpenedAt)}</td>
                    <td>第 {paper.lastPage} 页</td>
                    <td>
                      <div className="table-actions">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={() => applyEdit(paper)}>
                              保存
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                setEditingId(null);
                                setDraft(null);
                              }}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => props.onOpenPaper(paper)}>
                              打开阅读
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

function createDraft(
  value: EditablePaperFields | null,
  paper: PaperRecord
): EditablePaperFields {
  return (
    value ?? {
      chineseTitle: paper.chineseTitle,
      englishTitle: paper.englishTitle,
      journal: paper.journal,
      authors: paper.authors,
      year: paper.year
    }
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
