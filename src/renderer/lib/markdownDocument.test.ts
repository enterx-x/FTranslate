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

  it('renders markdown tables as real tables instead of a paragraph of pipes', () => {
    const html = renderMarkdownDocumentToHtml([
      '| 项目 | 依据 | 结论 |',
      '| --- | --- | --- |',
      '| 输入 | Figure 2 caption | 力信号和目标位姿 |'
    ].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<th>项目</th>');
    expect(html).toContain('<td>力信号和目标位姿</td>');
    expect(html).not.toContain('<p>| 项目');
  });

  it('renders markdown tables even when rows omit outer pipes', () => {
    const html = renderMarkdownDocumentToHtml([
      '项目 | 依据 | 结论',
      '--- | --- | ---',
      '输入 | Figure 2 caption | 力信号和目标位姿'
    ].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<th>项目</th>');
    expect(html).toContain('<td>力信号和目标位姿</td>');
  });

  it('does not corrupt KaTeX html classes while applying markdown emphasis', () => {
    const html = renderMarkdownDocumentToHtml('公式 $x_t = f(x, u)$ 和 _重点_。');

    expect(html).toContain('katex');
    expect(html).toContain('<em>重点</em>');
    expect(html).not.toContain('cjk<em>');
    expect(html).not.toContain('mathnormal<em>');
  });
});
