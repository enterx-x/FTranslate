import { describe, expect, it } from 'vitest';
import { renderMathTextToHtml } from './mathText';

describe('math text rendering', () => {
  it('renders inline and display math while escaping plain text', () => {
    const html = renderMathTextToHtml(
      'Loss is $L=\\sum_i x_i^2$.\n\n$$\\max_\\theta \\mathbb{E}[R]$$\n<script>alert(1)</script>'
    );

    expect(html).toContain('katex');
    expect(html).toContain('katex-display');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders parenthesized latex delimiters', () => {
    const html = renderMathTextToHtml('Dynamics \\(x_{t+1}=f(x_t,u_t)\\) are used.');

    expect(html).toContain('katex');
    expect(html).toContain('x');
    expect(html).toContain('t');
  });

  it('renders loose formula lines from extracted PDF text without requiring delimiters', () => {
    const html = renderMathTextToHtml(
      '5: a_{t+H} \\sim \\pi_\\theta(a|o_{t-T:t}, C)\n6: for t = 0, 1, 2, ... do'
    );

    expect(html).toContain('math-line');
    expect(html).toContain('katex');
    expect(html).toContain('line-prefix');
    expect(html).toContain('5:');
  });

  it('falls back to escaped source when latex is invalid', () => {
    const html = renderMathTextToHtml('Broken $\\frac{$ stays readable.');

    expect(html).toContain('Broken');
    expect(html).toContain('\\frac{');
  });
});
