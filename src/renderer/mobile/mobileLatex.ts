import type { ExtractedBlockType } from '../lib/pdfTextStructure';

const COMPLETE_MATH_DELIMITER = /(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/u;

export function formatMobileAcademicText(text: string, type: ExtractedBlockType): string {
  const normalized = text.trim();
  if (!normalized || COMPLETE_MATH_DELIMITER.test(normalized)) {
    return text;
  }
  if (type === 'formula') {
    return `$$${convertExtractedFormulaToLatex(normalized)}$$`;
  }
  if (type !== 'paragraph') {
    return text;
  }
  return convertInlineAcademicDefinitions(text);
}

export function convertInlineAcademicDefinitions(text: string): string {
  return text
    .replace(
      /D\s*=\s*\{\s*\(\s*o\s+t\s*,\s*A\s+t\s*,\s*F\s+t\s*:\s*t\s*\+\s*τ\s*,\s*S\s+t\s*:\s*t\s*\+\s*τ\s*\)\s*\}/gu,
      '\\(D = \\{(o_t, A_t, F_{t:t+\\tau}, S_{t:t+\\tau})\\}\\)'
    )
    .replace(
      /([AFS])\s+t(?:\s*:\s*t\s*\+\s*τ)?\s*=\s*\{\s*([afs])\s+t\s*\+\s*ℓ\s*\}\s*(h|τ)\s*ℓ\s*=\s*1/gu,
      (_match, target: string, value: string, horizon: string) => {
        const targetIndex = target === 'A' ? 't' : 't:t+\\tau';
        const renderedTarget = targetIndex === 't' ? `${target}_t` : `${target}_{${targetIndex}}`;
        const upper = horizon === 'τ' ? '\\tau' : horizon;
        return `\\(${renderedTarget} = \\{${value}_{t+\\ell}\\}_{\\ell=1}^{${upper}}\\)`;
      }
    )
    .replace(/\bo\s+t\b/gu, '\\(o_t\\)')
    .replace(/λ\s+([A-Z])\b/gu, (_match, suffix: string) => `\\(\\lambda_${suffix}\\)`);
}

export function convertExtractedFormulaToLatex(text: string): string {
  let formula = text.trim();
  const equationNumber = formula.match(/\s+\((\d{1,3})\)\s*$/u)?.[1];
  if (equationNumber) {
    formula = formula.replace(/\s+\(\d{1,3}\)\s*$/u, '');
  }
  formula = formula
    .replace(/\{/gu, '\\lbrace ')
    .replace(/\}/gu, ' \\rbrace');

  formula = formula
    .replace(/\.\.\./gu, '\\ldots ')
    .replace(/[−–—]/gu, '-')
    .replace(/Θ/gu, '\\Theta ')
    .replace(/θ/gu, '\\theta ')
    .replace(/λ/gu, '\\lambda ')
    .replace(/τ/gu, '\\tau ')
    .replace(/ℓ/gu, '\\ell ')
    .replace(/α/gu, '\\alpha ')
    .replace(/β/gu, '\\beta ')
    .replace(/π/gu, '\\pi ')
    .replace(/∇/gu, '\\nabla ')
    .replace(/[∑Σ]/gu, '\\sum ')
    .replace(/∏/gu, '\\prod ')
    .replace(/[∼~]/gu, '\\sim ')
    .replace(/≈/gu, '\\approx ')
    .replace(/≤/gu, '\\le ')
    .replace(/≥/gu, '\\ge ')
    .replace(/≠/gu, '\\ne ')
    .replace(/×/gu, '\\times ')
    .replace(/←/gu, '\\leftarrow ')
    .replace(/→/gu, '\\rightarrow ')
    .replace(/([A-Za-z])\s*ˆ\s*([A-Za-z](?:\s*,\s*[A-Za-z])?)/gu, (_match, symbol: string, index: string) => (
      `\\hat{${symbol}}_{${index.replace(/\s+/gu, '')}}`
    ))
    .replace(/\bL\s+act\s*,\s*m\s+i\b/gu, 'L_{\\mathrm{act},m_i}')
    .replace(/\bL\s+(force|tact)\b/gu, (_match, label: string) => `L_{\\mathrm{${label}}}`)
    .replace(/\\lambda\s+([A-Z])\b/gu, '\\lambda_$1')
    .replace(/\b([AFS])\s+t\s*:\s*t\s*\+\s*\\tau\b/gu, '$1_{t:t+\\tau}')
    .replace(/\b([oAaFfSs])\s+([tjk])(?:\s*,\s*([kℓ]))?/gu, (_match, symbol: string, first: string, second?: string) => (
      `${symbol}_{${first}${second ? `,${second === 'ℓ' ? '\\ell' : second}` : ''}}`
    ))
    .replace(/\s*\(\s*/gu, '(')
    .replace(/\s*\)\s*/gu, ')')
    .replace(/\s*,\s*/gu, ', ')
    .replace(/\s*:\s*/gu, ':')
    .replace(/\s*\+\s*/gu, ' + ')
    .replace(/\s*=\s*/gu, ' = ')
    .replace(/\s+/gu, ' ')
    .trim();

  return equationNumber ? `${formula} \\tag{${equationNumber}}` : formula;
}
