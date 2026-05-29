import noteIcon from '../assets/icons/duotone/note.svg';
import type { PaperRecord } from '../lib/papers';
import { MathText } from './MathText';

interface NotesPanelProps {
  notes: string;
  paper?: PaperRecord | null;
  pdfPage?: number;
  linkedRowIndex?: number;
  linkedRowValues?: Record<string, string> | null;
  onChange: (value: string) => void;
  onOpenPaper?: () => void;
  onOpenResearchSheet?: () => void;
}

const NOTE_TEMPLATES = [
  {
    label: '核心结论',
    content: '## 核心结论\n- \n\n'
  },
  {
    label: '疑问',
    content: '## 待读问题\n- 论文没有解释清楚的是：\n- 需要回看公式/实验的位置：\n\n'
  },
  {
    label: '复现计划',
    content: '## 复现计划\n- 环境/代码：\n- 数据/任务：\n- baseline：\n- 指标：\n- 风险：\n\n'
  },
  {
    label: '研究 idea',
    content: '## 后续 idea\n- 科学问题：\n- 技术路线：\n- 对照实验：\n- 预期失败原因：\n\n'
  },
  {
    label: '公式推导',
    content: '## 公式推导\n- 关键公式：$E=mc^2$\n- 推导疑点：\n- 与方法模块的对应关系：\n\n'
  },
  {
    label: '局限性',
    content: '## 局限性\n- 数据/环境局限：\n- 方法假设：\n- 可能失败场景：\n\n'
  },
  {
    label: '可借鉴点',
    content: '## 可借鉴点\n- 可复用模块：\n- 可迁移实验设计：\n- 可作为对照的 baseline：\n\n'
  }
];

export function NotesPanel(props: NotesPanelProps) {
  const wordCount = props.notes.trim() ? props.notes.trim().length : 0;

  function insertTemplate(content: string): void {
    const prefix = props.notes.trim() ? `${props.notes.trimEnd()}\n\n` : '';
    props.onChange(`${prefix}${content}`);
  }

  return (
    <details className="notes-panel" open>
      <summary>
        <span className="summary-title-with-icon">
          <img className="panel-title-icon" src={noteIcon} alt="" />
          <span>阅读笔记</span>
        </span>
        <small>{wordCount > 0 ? `${wordCount} 字 · 已自动保存` : '记录想法、公式推导或复现计划'}</small>
      </summary>

      <div className="notes-editor-meta">
        <span className="badge">Markdown</span>
        <span className="badge">公式 $...$ / $$...$$</span>
        <span className="badge success">自动保存</span>
        <span className="subtle">{wordCount} 字</span>
        {props.paper ? <span className="subtle">关联：{props.paper.chineseTitle || props.paper.englishTitle || props.paper.pdfName}</span> : null}
        {props.pdfPage ? <span className="subtle">第 {props.pdfPage} 页</span> : null}
      </div>

      <div className="notes-template-bar" aria-label="笔记模板">
        {NOTE_TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            className="notes-pill-button"
            onClick={() => insertTemplate(template.content)}
            title={`插入${template.label}模板`}
          >
            {template.label}
          </button>
        ))}
        <button
          type="button"
          className="notes-pill-button"
          disabled={!props.notes.trim()}
          onClick={() => void navigator.clipboard.writeText(props.notes)}
          title="复制当前笔记"
        >
          复制
        </button>
      </div>

      <label className="notes-editor-field">
        <span>笔记内容</span>
        <textarea
          value={props.notes}
          rows={10}
          placeholder="写下这篇论文的关键结论、可复现实验、疑问或后续 idea。内容会自动保存到本机论文库。"
          onChange={(event) => props.onChange(event.target.value)}
        />
      </label>
      <div className="notes-formula-hint">
        支持公式渲染：行内公式写作 <code>$E=mc^2$</code>，块级公式写作 <code>$$L = L_data + λL_physics$$</code>。
      </div>
      {props.notes.trim() ? (
        <section className="notes-preview-card">
          <strong>笔记预览</strong>
          <MathText text={props.notes} />
        </section>
      ) : null}
      {props.linkedRowValues ? (
        <section className="notes-link-card">
          <header>
            <strong>关联研究表格行</strong>
            <span>{props.linkedRowIndex && props.linkedRowIndex > 0 ? `第 ${props.linkedRowIndex + 1} 行` : '已关联'}</span>
          </header>
          <div className="row-detail-list compact">
            {Object.entries(props.linkedRowValues).map(([key, value]) =>
              value.trim() ? (
                <p key={key}>
                  <span>{key}</span>
                  <em>{value}</em>
                </p>
              ) : null
            )}
          </div>
          <div className="notes-link-actions">
            <button type="button" className="secondary-button" disabled={!props.onOpenPaper} onClick={props.onOpenPaper}>
              查看对应论文
            </button>
            <button type="button" className="secondary-button" disabled={!props.onOpenResearchSheet} onClick={props.onOpenResearchSheet}>
              跳转研究表格
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void navigator.clipboard.writeText(formatLinkedRow(props.linkedRowValues ?? {}))}
            >
              复制行信息
            </button>
          </div>
        </section>
      ) : null}
    </details>
  );
}

function formatLinkedRow(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${value || '-'}`)
    .join('\n');
}
