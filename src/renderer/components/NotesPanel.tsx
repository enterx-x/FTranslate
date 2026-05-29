import noteIcon from '../assets/icons/duotone/note.svg';

interface NotesPanelProps {
  notes: string;
  onChange: (value: string) => void;
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
        <small>{wordCount > 0 ? `${wordCount} 字，已自动保存` : '记录想法、公式推导或复现计划'}</small>
      </summary>
      <div className="notes-template-bar">
        {NOTE_TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            onClick={() => insertTemplate(template.content)}
            title={`插入${template.label}模板`}
          >
            {template.label}
          </button>
        ))}
        <button
          type="button"
          disabled={!props.notes.trim()}
          onClick={() => void navigator.clipboard.writeText(props.notes)}
          title="复制当前笔记"
        >
          复制
        </button>
      </div>
      <textarea
        value={props.notes}
        rows={10}
        placeholder="写下这篇论文的关键结论、可复现实验、疑问或后续 idea。内容会自动保存到本机论文库。"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </details>
  );
}
