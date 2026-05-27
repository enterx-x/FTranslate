interface NotesPanelProps {
  notes: string;
  onChange: (value: string) => void;
}

export function NotesPanel(props: NotesPanelProps) {
  return (
    <details className="notes-panel">
      <summary>
        <span>阅读笔记</span>
        <small>{props.notes.trim() ? '已保存到论文库' : '记录想法、公式推导或复现计划'}</small>
      </summary>
      <textarea
        value={props.notes}
        rows={6}
        placeholder="写下这篇论文的关键结论、可复现实验、疑问或后续 idea。内容会自动保存到本机论文库。"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </details>
  );
}
