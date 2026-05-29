import { MathText } from './MathText';

interface InsightMarkdownProps {
  text: string;
}

export function InsightMarkdown(props: InsightMarkdownProps) {
  const blocks = props.text
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="literature-insight-rendered">
      {blocks.map((block, index) => {
        const heading = block.match(/^(#{1,3})\s+(.+)$/u);
        if (heading) {
          const HeadingTag = heading[1].length === 1 ? 'h3' : 'h4';
          return (
            <HeadingTag key={index}>
              <MathText text={heading[2]} />
            </HeadingTag>
          );
        }

        const listLines = block.split('\n').filter((line) => /^\s*(?:[-*]|\d+\.)\s+/u.test(line));
        if (listLines.length >= 2) {
          return (
            <ul key={index}>
              {listLines.map((line, itemIndex) => (
                <li key={itemIndex}>
                  <MathText text={line.replace(/^\s*(?:[-*]|\d+\.)\s+/u, '')} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index}>
            <MathText text={block} />
          </p>
        );
      })}
    </div>
  );
}
