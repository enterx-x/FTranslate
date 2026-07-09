import { describe, expect, it } from 'vitest';
import type { CodeRepositoryRecord } from './codeRepositories';
import { buildExperimentMatrixRowsFromMethodCard } from './experimentMatrix';
import type { MethodCard } from './methodCards';
import { buildPaperToCodeMapping } from './paperToCodeMapping';
import { diagnoseReproductionLog } from './reproductionLogDiagnostics';
import { buildReproductionRunPlan } from './reproductionRunPlan';
import { buildReproductionTaskPackage, renderReproductionTaskPackageMarkdown } from './reproductionTaskPackage';

const now = '2026-07-09T00:00:00.000Z';

const repository: CodeRepositoryRecord = {
  id: 'code-repo-safe-rl',
  projectId: 'local-ai-rd-workspace',
  rootPath: 'D:/demo/safe-rl',
  scannedAt: now,
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
      excerpt: 'algorithm: PPO\nsafety_layer: CBF\nmetric: collision_rate\n'
    }
  ],
  risks: []
};

const methodCard: MethodCard = {
  id: 'method-card-safe-rl-demo',
  projectId: 'local-ai-rd-workspace',
  paperId: 'demo-paper-safe-rl-navigation',
  title: 'Safe RL Navigation Demo',
  status: 'needs-review',
  createdAt: now,
  updatedAt: now,
  version: 1,
  evidenceSources: [
    {
      id: 'evidence-baseline',
      paperId: 'demo-paper-safe-rl-navigation',
      type: 'pdf-text',
      locator: 'p. 6 | Experiments',
      text: 'PPO baseline is used for comparison.',
      score: 5
    },
    {
      id: 'evidence-constraints',
      paperId: 'demo-paper-safe-rl-navigation',
      type: 'pdf-text',
      locator: 'p. 4 | Method',
      text: 'CBF safety constraints are applied as a safety layer.',
      score: 5
    },
    {
      id: 'evidence-metrics',
      paperId: 'demo-paper-safe-rl-navigation',
      type: 'table-caption',
      locator: 'p. 8 | Table 2',
      text: 'Collision rate and success rate are reported.',
      score: 5
    }
  ],
  fields: [
    {
      key: 'baseline',
      label: 'Baseline',
      value: 'PPO baseline',
      confidence: 0.82,
      evidenceSourceIds: ['evidence-baseline'],
      reviewState: 'unconfirmed'
    },
    {
      key: 'constraints',
      label: 'Constraints',
      value: 'CBF safety constraints',
      confidence: 0.84,
      evidenceSourceIds: ['evidence-constraints'],
      reviewState: 'unconfirmed'
    },
    {
      key: 'metrics',
      label: 'Evaluation Metrics',
      value: 'collision rate and success rate',
      confidence: 0.76,
      evidenceSourceIds: ['evidence-metrics'],
      reviewState: 'unconfirmed'
    }
  ]
};

describe('buildReproductionTaskPackage', () => {
  it('turns method, code, diagnosis, run plan and experiment rows into a blocked manual handoff package', () => {
    const mapping = buildPaperToCodeMapping({ methodCard, repository });
    const diagnosis = diagnoseReproductionLog({
      repository,
      now,
      logText: [
        'Traceback (most recent call last):',
        '  File "D:/demo/safe-rl/train_ppo.py", line 1, in <module>',
        '    import gymnasium',
        "ModuleNotFoundError: No module named 'gymnasium'"
      ].join('\n')
    });
    const runPlan = buildReproductionRunPlan({ repository, diagnosis, now });
    const experimentRows = buildExperimentMatrixRowsFromMethodCard(methodCard);

    const taskPackage = buildReproductionTaskPackage({
      projectId: repository.projectId,
      methodCard,
      experimentRows,
      mapping,
      diagnosis,
      runPlan,
      now
    });

    expect(taskPackage.status).toBe('blocked');
    expect(taskPackage.executionPolicy).toBe('manual-only');
    expect(taskPackage.timeboxMinutes).toBe(15);
    expect(taskPackage.qualityGate).toMatchObject({ passed: true, missingEvidence: [] });
    expect(taskPackage.qualityGate.requiredEvidence).toEqual([
      'method-card',
      'paper-to-code-mapping',
      'reproduction-diagnosis',
      'manual-run-plan',
      'experiment-matrix'
    ]);
    expect(taskPackage.nextAction).toMatchObject({
      command: 'python -m pip install -r requirements.txt',
      commandKind: 'environment-mutating',
      requiresUserConfirmation: true,
      blockedByIssueIds: ['missing-dependency:gymnasium']
    });
    expect(taskPackage.linkedExperimentRows.length).toBeGreaterThanOrEqual(2);
    expect(taskPackage.linkedExperimentRows.every((row) => row.status === 'blocked')).toBe(true);
    expect(taskPackage.linkedExperimentRows[0].evidence).toEqual(
      expect.arrayContaining(['requirements.txt', 'train_ppo.py', 'configs/cbf_navigation.yaml'])
    );
  });

  it('fails the quality gate when the package lacks code mapping or experiment rows', () => {
    const diagnosis = diagnoseReproductionLog({ repository, now, logText: 'training completed' });
    const runPlan = buildReproductionRunPlan({ repository, diagnosis, now });
    const mapping = {
      methodCardId: methodCard.id,
      repositoryId: repository.id,
      rows: [],
      coverage: { methodConceptCount: 3, mappedConceptCount: 0 },
      risks: []
    };

    const taskPackage = buildReproductionTaskPackage({
      projectId: repository.projectId,
      methodCard,
      experimentRows: [],
      mapping,
      diagnosis,
      runPlan,
      now
    });

    expect(taskPackage.qualityGate.passed).toBe(false);
    expect(taskPackage.qualityGate.missingEvidence).toEqual(
      expect.arrayContaining(['paper-to-code-mapping', 'experiment-matrix'])
    );
  });

  it('renders a human handoff markdown without implying automatic execution', () => {
    const mapping = buildPaperToCodeMapping({ methodCard, repository });
    const diagnosis = diagnoseReproductionLog({
      repository,
      now,
      logText: "ModuleNotFoundError: No module named 'gymnasium'"
    });
    const runPlan = buildReproductionRunPlan({ repository, diagnosis, now });
    const taskPackage = buildReproductionTaskPackage({
      projectId: repository.projectId,
      methodCard,
      experimentRows: buildExperimentMatrixRowsFromMethodCard(methodCard),
      mapping,
      diagnosis,
      runPlan,
      now
    });

    const markdown = renderReproductionTaskPackageMarkdown(taskPackage);

    expect(markdown).toContain('15-minute reproduction task package');
    expect(markdown).toContain('Manual only');
    expect(markdown).toContain('Paper-to-Code');
    expect(markdown).toContain('Experiment Matrix');
    expect(markdown).toContain('FTranslate does not run repository code or package managers');
  });
});
