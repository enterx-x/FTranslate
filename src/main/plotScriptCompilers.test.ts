import { describe, expect, it } from 'vitest';
import { assertGeneratedPlotScript, compilePlotScript } from './plotScriptCompilers';

describe('controlled plot script compilers', () => {
  it('generates fixed Python, R and MATLAB programs that read controlled files', () => {
    for (const language of ['python', 'r', 'matlab'] as const) {
      const script = compilePlotScript(language);
      expect(assertGeneratedPlotScript(script)).toBe(true);
      expect(script.content).toContain('plot-spec.json');
      expect(script.content).toContain('data.csv');
      expect(script.supportedChartTypes).toContain('surface3d');
    }
  });

  it('does not accept user content as compiler input', () => {
    expect(compilePlotScript.length).toBe(1);
    expect(compilePlotScript('python').content).not.toContain('malicious user title');
  });

  it('keeps MATLAB detect-only capability exclusions explicit', () => {
    const matlab = compilePlotScript('matlab');
    expect(matlab.supportedChartTypes).not.toContain('alluvial');
    expect(matlab.supportedChartTypes).not.toContain('raincloud');
    expect(matlab.content).not.toMatch(/websave|system\(|!\s/);
  });

  it('applies the shared axis specification in every external renderer', () => {
    expect(compilePlotScript('python').content).toContain("apply_axis('x')");
    expect(compilePlotScript('python').content).toContain("axis.get('tickInterval')");
    expect(compilePlotScript('r').content).toContain("axis_by_id('x')");
    expect(compilePlotScript('r').content).toContain('scale_x_continuous');
    expect(compilePlotScript('matlab').content).toContain("applyAxisSpec(ax,spec,'x')");
    expect(compilePlotScript('matlab').content).toContain("ax.XScale='log'");
  });
});
