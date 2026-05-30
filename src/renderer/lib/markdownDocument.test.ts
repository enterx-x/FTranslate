import { describe, expect, it } from 'vitest';
import { renderMarkdownDocumentToHtml } from './markdownDocument';

describe('markdown document rendering', () => {
  it('renders headings, lists and inline emphasis without exposing markdown markers', () => {
    const html = renderMarkdownDocumentToHtml([
      '## 可借鉴点',
      '- **可复用模块**：安全约束',
      '- 可迁移实验设计：多 seed',
      '',
      '公式 $E=mc^2$ and `sourceHash`.'
    ].join('\n'));

    expect(html).toContain('<h3>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<code>sourceHash</code>');
    expect(html).toContain('katex');
    expect(html).not.toContain('## 可借鉴点');
    expect(html).not.toContain('- **可复用模块**');
  });

  it('escapes unsafe html while keeping a readable document preview', () => {
    const html = renderMarkdownDocumentToHtml('> <script>alert(1)</script>\n\nPlain paragraph.');

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('<script>');
  });
});
