import { describe, expect, it } from 'vitest';
import { EXPERIMENT_MATRICES_KEY } from './experimentMatrix';
import { METHOD_CARDS_KEY } from './methodCards';
import { PAPER_LIBRARY_KEY } from './papers';
import { RESEARCH_PROJECTS_KEY } from './researchProjects';
import {
  buildResearchLoopDemo,
  buildResearchLoopDemoArtifacts,
  buildResearchLoopDemoSummary,
  createDefaultResearchLoopDemoInput
} from './researchLoopDemo';

describe('headless research loop demo', () => {
  it('builds a reproducible paper evidence to experiment matrix loop', () => {
    const result = buildResearchLoopDemo(createDefaultResearchLoopDemoInput());

    expect(result.qualityGate.passed).toBe(true);
    expect(result.methodCard.status).toBe('needs-review');
    expect(result.methodCard.evidenceSources.length).toBeGreaterThanOrEqual(4);
    expect(result.methodCard.fields.filter((field) => field.value && field.evidenceSourceIds.length > 0).length)
      .toBeGreaterThanOrEqual(6);
    expect(result.experimentRows.map((row) => row.group)).toEqual(['baseline', 'proposed', 'ablation']);
    expect(result.experimentRows.every((row) => row.evidenceLocators.length > 0)).toBe(true);
    expect(result.matrixMarkdown).toContain('# 实验矩阵');
    expect(result.matrixMarkdown).toContain('安全强化学习机器人导航 Demo');
    expect(result.matrixMarkdown).toContain('p. 7 · Results');
    expect(Object.keys(result.storageSnapshot).sort()).toEqual(
      [EXPERIMENT_MATRICES_KEY, METHOD_CARDS_KEY, PAPER_LIBRARY_KEY, RESEARCH_PROJECTS_KEY].sort()
    );
  });

  it('emits stable demo artifacts for a repeatable CLI run', () => {
    const result = buildResearchLoopDemo(createDefaultResearchLoopDemoInput());
    const summary = buildResearchLoopDemoSummary(result);
    const artifacts = buildResearchLoopDemoArtifacts(result);

    expect(summary).toMatchObject({
      projectId: 'local-ai-rd-workspace',
      paperId: 'demo-paper-safe-rl-navigation',
      methodCardStatus: 'needs-review',
      experimentRowCount: 3,
      experimentGroups: ['baseline', 'proposed', 'ablation'],
      qualityPassed: true
    });
    expect(Object.keys(artifacts).sort()).toEqual([
      'README.md',
      'experiment-matrix.md',
      'local-storage-seed.json',
      'method-card.json',
      'research-loop-summary.json'
    ]);
    expect(JSON.parse(artifacts['local-storage-seed.json'])).toHaveProperty(METHOD_CARDS_KEY);
    expect(artifacts['README.md']).toContain('npm run demo:research-loop');
  });

  it('fails the quality gate when sample evidence cannot produce experiments', () => {
    const input = createDefaultResearchLoopDemoInput();
    const result = buildResearchLoopDemo({
      ...input,
      paper: {
        ...input.paper,
        notes: ''
      },
      blocks: []
    });

    expect(result.qualityGate.passed).toBe(false);
    expect(result.experimentRows).toEqual([]);
    expect(result.qualityGate.checks.find((check) => check.id === 'experiment-row-count')).toMatchObject({
      passed: false
    });
  });
});
