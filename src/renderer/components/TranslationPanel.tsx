import type { TranslationDocument } from '../lib/translation';

interface TranslationPanelProps {
  document: TranslationDocument | null;
  currentIndex: number;
  showTranslation: boolean;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (value: string) => void;
  onPrevious: () => void;
  onShowTranslation: () => void;
  onNext: () => void;
  onStartEdit: () => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
  onCopyCurrentPrompt: () => void;
  onCopyFullPrompt: () => void;
}

export function TranslationPanel(props: TranslationPanelProps) {
  if (!props.document || props.document.items.length === 0) {
    return (
      <div className="empty-state">
        <h2>未打开翻译文件</h2>
        <p>请导入 JSON 或 Markdown 翻译文件。JSON 支持原文与译文交互显示。</p>
      </div>
    );
  }

  const item = props.document.items[props.currentIndex];
  const isJson = props.document.kind === 'json';
  const shouldShowTranslation = props.showTranslation || props.document.kind === 'markdown';

  return (
    <div className="translation-panel">
      <div className="pane-title">
        <span>{props.document.sourceName ?? '翻译文件'}</span>
        <span className="subtle">
          {props.currentIndex + 1} / {props.document.items.length}
        </span>
      </div>

      <div className="section-meta">
        <span className="section-label">Section</span>
        <strong>{item.section}</strong>
      </div>

      <article className="reader-card original-card">
        <div className="card-header">Original</div>
        {isJson ? (
          <p>{item.original || '当前 JSON 段落没有 original 字段内容。'}</p>
        ) : (
          <p className="subtle">Markdown 模式不包含英文原文字段，右侧仅按中文段落阅读。</p>
        )}
      </article>

      <article className="reader-card translation-card">
        <div className="card-header">Translation</div>
        {props.isEditing ? (
          <div className="editor-block">
            <textarea
              value={props.editingText}
              onChange={(event) => props.onEditingTextChange(event.target.value)}
              rows={12}
            />
            <div className="editor-actions">
              <button type="button" onClick={props.onApplyEdit}>
                应用修改
              </button>
              <button type="button" className="secondary-button" onClick={props.onCancelEdit}>
                取消
              </button>
            </div>
          </div>
        ) : shouldShowTranslation ? (
          <p>{item.translation || '当前段落暂无中文译文。'}</p>
        ) : (
          <p className="translation-placeholder">点击“翻译当前段”显示中文译文。</p>
        )}
      </article>

      <article className="reader-card prompt-card">
        <div className="card-header">AI 提示词</div>
        <p className="subtle">
          手动模式下可把提示词复制给其它 AI，让它按 section、original、translation
          三字段生成 JSON 翻译文件。
        </p>
        <div className="panel-actions">
          <button type="button" onClick={props.onCopyCurrentPrompt}>
            复制当前段 JSON 提示词
          </button>
          <button type="button" onClick={props.onCopyFullPrompt}>
            复制全文 JSON 提示词
          </button>
        </div>
      </article>

      <div className="paragraph-actions">
        <button type="button" onClick={props.onPrevious} disabled={props.currentIndex === 0}>
          上一段原文
        </button>
        <button type="button" onClick={props.onShowTranslation} disabled={!isJson}>
          翻译当前段
        </button>
        <button
          type="button"
          onClick={props.onNext}
          disabled={props.currentIndex >= props.document.items.length - 1}
        >
          下一段原文
        </button>
        <button type="button" onClick={props.onStartEdit}>
          编辑译文
        </button>
      </div>
    </div>
  );
}
