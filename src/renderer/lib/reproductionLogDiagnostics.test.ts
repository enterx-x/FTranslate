import { describe, expect, it } from 'vitest';
import type { CodeRepositoryRecord } from './codeRepositories';
import { diagnoseReproductionLog } from './reproductionLogDiagnostics';

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

describe('diagnoseReproductionLog', () => {
  it('links a missing declared dependency to the manifest and traceback file', () => {
    const diagnosis = diagnoseReproductionLog({
      repository,
      now: '2026-07-08T00:00:00.000Z',
      logText: [
        'Traceback (most recent call last):',
        '  File "D:/demo/safe-rl/train_ppo.py", line 3, in <module>',
        '    import gymnasium',
        "ModuleNotFoundError: No module named 'gymnasium'"
      ].join('\n')
    });

    expect(diagnosis.status).toBe('blocked');
    expect(diagnosis.issues).toHaveLength(1);
    expect(diagnosis.issues[0]).toMatchObject({
      kind: 'missing-dependency',
      severity: 'blocked',
      relatedFiles: ['train_ppo.py'],
      relatedManifests: ['requirements.txt']
    });
    expect(diagnosis.issues[0].title).toContain('gymnasium');
    expect(diagnosis.issues[0].summary).toContain('已在依赖清单中声明');
    expect(diagnosis.issues[0].evidenceLines.map((line) => line.lineNumber)).toContain(4);
    expect(diagnosis.issues[0].commandCandidates).toContain('python -m pip install -r requirements.txt');
  });

  it('diagnoses a missing file without pretending the repo was executed', () => {
    const diagnosis = diagnoseReproductionLog({
      repository,
      now: '2026-07-08T00:00:00.000Z',
      logText: [
        'Traceback (most recent call last):',
        '  File "train_ppo.py", line 9, in main',
        "FileNotFoundError: [Errno 2] No such file or directory: 'configs/missing_navigation.yaml'"
      ].join('\n')
    });

    expect(diagnosis.status).toBe('blocked');
    expect(diagnosis.issues[0]).toMatchObject({
      kind: 'missing-file',
      severity: 'blocked',
      relatedFiles: ['train_ppo.py', 'configs/cbf_navigation.yaml']
    });
    expect(diagnosis.issues[0].summary).toContain('configs/missing_navigation.yaml');
    expect(diagnosis.issues[0].nextActions.join('\n')).toContain('确认命令中的相对路径');
    expect(diagnosis.issues[0].commandCandidates).toEqual([]);
  });
});
