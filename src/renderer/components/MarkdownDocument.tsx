import { renderMarkdownDocumentToHtml } from '../lib/markdownDocument';

interface MarkdownDocumentProps {
  text: string;
  className?: string;
}

export function MarkdownDocument(props: MarkdownDocumentProps) {
  return (
    <div
      className={`markdown-document ${props.className ?? ''}`.trim()}
      dangerouslySetInnerHTML={{ __html: renderMarkdownDocumentToHtml(props.text) }}
    />
  );
}
