import { MarkdownDocument } from './MarkdownDocument';

interface InsightMarkdownProps {
  text: string;
}

export function InsightMarkdown(props: InsightMarkdownProps) {
  return <MarkdownDocument text={props.text} className="literature-insight-rendered" />;
}
