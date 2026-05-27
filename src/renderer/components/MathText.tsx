import { renderMathTextToHtml } from '../lib/mathText';

interface MathTextProps {
  text: string;
  className?: string;
}

export function MathText(props: MathTextProps) {
  return (
    <span
      className={props.className ? `math-text ${props.className}` : 'math-text'}
      dangerouslySetInnerHTML={{ __html: renderMathTextToHtml(props.text) }}
    />
  );
}
