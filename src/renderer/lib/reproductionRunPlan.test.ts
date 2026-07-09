import { describe, expect, it } from 'vitest';
import type { CodeRepositoryRecord } from './codeRepositories';
import { diagnoseReproductionLog } from './reproductionLogDiagnostics';
import { buildReproductionRunPlan, renderReproductionRunPlanMarkdown } from './reproductionRunPlan';

const repository: CodeRepositoryRecord = {
  id: 'code-repo-safe-rl',
  projectId: 'local-ai-rd-workspace',
  rootPath: 'D:/demo/safe-rl',
  scannedAt: '2026-07-01T00:00:00.000Z',
  techStack: ['python', 'pytorch', 'gymnasium'],
  manifests: [
    {
      filePath: 'requirements.txt',
      fileName: 'requirements.txt',
      kind: 'requirements',
      dependencies: ['torch==2.2.0', 'gymnasium==0.29.1', 'numpy==1.26.4']
    }
  ],
  entryPoints: [
    {
      filePath: 'train_ppo.py',
      kind: 'train',
      commandCandidate: 'python train_ppo.py',
      reason: 'train_ppo.py matches a train entry-point naming pattern.'
    }
  ],
  configFiles: [
    {
      filePath: 'configs/cbf_navigation.yaml',
      role: 'config',
      excerpt: 'algorithm: PPO\nsafety_layer: CBF\n'
    }
  ],
  risks: []
};

describe('buildReproductionRunPlan', () => {
  it('turns a blocked dependency diagnosis into a manual environment repair plan', () => {
    const diagnosis = diagnoseReproductionLog({
      repository,
      now: '2026-07-09T00:00:00.000Z',
      logText: [
        'Traceback (most recent call last):',
        '  File "D:/demo/safe-rl/train_ppo.py", line 3, in <module>',
        '    import gymnasium',
        "ModuleNotFoundError: No module named 'gymnasium'"
      ].join('\n')
    });

    const plan = buildReproductionRunPlan({
      repository,
      diagnosis,
      now: '2026-07-09T00:10:00.000Z'
    });

    expect(plan.status).toBe('blocked');
    expect(plan.executionPolicy).toBe('manual-only');
    expect(plan.steps[0]).toMatchObject({
      phase: 'prepare-environment',
      command: 'python -m pip install -r requirements.txt',
      commandKind: 'environment-mutating',
      requiresUserConfirmation: true,
      blockedByIssueIds: ['missing-dependency:gymnasium']
    });
    expect(plan.steps[0].evidence).toEqual(expect.arrayContaining(['requirements.txt', 'train_ppo.py']));
    expect(plan.steps.some((step) => step.phase === 'run-smoke-test' && step.blockedByIssueIds.length > 0)).toBe(true);
  });

  it('creates a ready smoke-test plan when diagnosis is clean', () => {
    const diagnosis = diagnoseReproductionLog({
      repository,
      now: '2026-07-09T00:00:00.000Z',
      logText: 'training completed without traceback'
    });

    const plan = buildReproductionRunPlan({
      repository,
      diagnosis,
      now: '2026-07-09T00:10:00.000Z'
    });

    expect(plan.status).toBe('ready');
    const smokeStep = plan.steps.find((step) => step.phase === 'run-smoke-test');
    expect(smokeStep).toMatchObject({
      command: 'python train_ppo.py --config configs/cbf_navigation.yaml',
      commandKind: 'repo-execution',
      requiresUserConfirmation: true,
      blockedByIssueIds: []
    });
    expect(smokeStep?.evidence).toEqual(expect.arrayContaining(['train_ppo.py', 'configs/cbf_navigation.yaml']));
    expect(renderReproductionRunPlanMarkdown(plan)).toContain('Manual only');
  });
});
