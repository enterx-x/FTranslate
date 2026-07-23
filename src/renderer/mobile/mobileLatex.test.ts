import { describe, expect, it } from 'vitest';
import { renderMathTextToHtml } from '../lib/mathText';
import {
  convertExtractedFormulaToLatex,
  formatMobileAcademicText
} from './mobileLatex';

describe('mobile academic LaTeX formatting', () => {
  it('rebuilds TouchDreaming inline set definitions as LaTeX without changing prose', () => {
    const source = 'Objective. Let dataset D = { ( o t, A t, F t: t + τ, S t: t + τ ) }, where o t is the multimodal observation at time t, A t = { a t + ℓ } h ℓ =1 is the action chunk of horizon h, F t: t + τ = { f t + ℓ } τ ℓ =1 is the future force sequence and S t: t + τ = { s t + ℓ } τ ℓ =1 is the future tactile sequence.';
    const formatted = formatMobileAcademicText(source, 'paragraph');

    expect(formatted).toContain('\\(D = \\{(o_t, A_t, F_{t:t+\\tau}, S_{t:t+\\tau})\\}\\)');
    expect(formatted).toContain('\\(A_t = \\{a_{t+\\ell}\\}_{\\ell=1}^{h}\\)');
    expect(formatted).toContain('\\(F_{t:t+\\tau} = \\{f_{t+\\ell}\\}_{\\ell=1}^{\\tau}\\)');
    expect(formatted).toContain('\\(S_{t:t+\\tau} = \\{s_{t+\\ell}\\}_{\\ell=1}^{\\tau}\\)');
    expect(formatted).toContain('where \\(o_t\\) is the multimodal observation');
    expect(renderMathTextToHtml(formatted)).toContain('katex');
  });

  it('renders extracted loss expressions as display LaTeX', () => {
    const source = 'L (Θ) = L act, m i (Θ) + λ F L force (Θ) + λ Z L tact (Θ) (5)';
    const latex = convertExtractedFormulaToLatex(source);
    const formatted = formatMobileAcademicText(source, 'formula');
    const html = renderMathTextToHtml(formatted);

    expect(latex).toBe('L(\\Theta) = L_{\\mathrm{act}, m_i}(\\Theta) + \\lambda_F L_{\\mathrm{force}}(\\Theta) + \\lambda_Z L_{\\mathrm{tact}}(\\Theta) \\tag{5}');
    expect(formatted.startsWith('$$')).toBe(true);
    expect(html).toContain('katex-display');
    expect(html).not.toContain('katex-error');
  });

  it('rebuilds common extracted sums, fractions, norms, roots, and powers', () => {
    const loss = convertExtractedFormulaToLatex('J (θ) = 1 / N ∑ N i = 1 ‖ fˆ i - f i ‖ 2 (6)');
    const distance = convertExtractedFormulaToLatex('d = √ ( x 2 + y 2 )');

    expect(loss).toBe(
      'J(\\theta) = \\frac{1}{N} \\sum_{i=1}^{N} \\lVert \\hat{f}_i - f_i \\rVert^2 \\tag{6}'
    );
    expect(distance).toBe('d = \\sqrt{x^2 + y^2}');
    expect(renderMathTextToHtml(`$$${loss}$$`)).not.toContain('katex-error');
    expect(renderMathTextToHtml(`$$${distance}$$`)).not.toContain('katex-error');
  });

  it('rebuilds only complete rectangular matrix literals', () => {
    expect(convertExtractedFormulaToLatex('M = [ a b ; c d ]')).toBe(
      'M = \\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}'
    );
    expect(convertExtractedFormulaToLatex('range = [ a b c ]')).toBe('range = [ a b c ]');
  });

  it('does not rewrite headings, captions, or already delimited LaTeX', () => {
    expect(formatMobileAcademicText('E. Training Paradigm', 'heading')).toBe('E. Training Paradigm');
    expect(formatMobileAcademicText('Fig. 4: Policy overview.', 'caption')).toBe('Fig. 4: Policy overview.');
    expect(formatMobileAcademicText('Loss is $L=\\sum_i x_i$.', 'paragraph')).toBe('Loss is $L=\\sum_i x_i$.');
  });
});
