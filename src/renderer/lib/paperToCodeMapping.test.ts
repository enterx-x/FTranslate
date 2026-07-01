import { describe, expect, it } from 'vitest';
import { buildPaperToCodeMapping } from './paperToCodeMapping';
import type { MethodCard } from './methodCards';

function makeMethodCard(): MethodCard {
  return {
    id: 'method-1',
    projectId: 'local-ai-rd-workspace',
    paperId: 'paper-1',
    title: 'Safe RL',
    status: 'needs-review',
    version: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    evidenceSources: [],
    fields: [
      {
        key: 'baseline',
        label: 'Baseline',
        value: 'PPO baseline',
        confidence: 0.8,
        evidenceSourceIds: ['e1'],
        reviewState: 'unconfirmed'
      },
      {
        key: 'constraints',
        label: 'Constraints',
        value: 'CBF safety constraints',
        confidence: 0.8,
        evidenceSourceIds: ['e2'],
        reviewState: 'unconfirmed'
      }
    ]
  };
}

describe('buildPaperToCodeMapping', () => {
  it('maps method-card concepts to repository evidence candidates', () => {
    const mapping = buildPaperToCodeMapping({
      methodCard: makeMethodCard(),
      repository: {
        id: 'repo-1',
        projectId: 'local-ai-rd-workspace',
        rootPath: 'D:\\repo',
        scannedAt: '2026-07-01T00:00:00.000Z',
        techStack: ['python'],
        manifests: [],
        entryPoints: [
          { filePath: 'train_ppo.py', kind: 'train', commandCandidate: 'python train_ppo.py', reason: 'train script' }
        ],
        configFiles: [
          { filePath: 'configs/cbf.yaml', role: 'config', excerpt: 'cbf: true' }
        ],
        risks: []
      }
    });

    expect(mapping.rows.map((row) => row.concept)).toContain('PPO baseline');
    expect(mapping.rows.some((row) => row.codeEvidencePath === 'train_ppo.py')).toBe(true);
    expect(mapping.rows.some((row) => row.codeEvidencePath === 'configs/cbf.yaml')).toBe(true);
    expect(mapping.coverage.mappedConceptCount).toBeGreaterThan(0);
  });

  it('does not map ungrounded method fields', () => {
    const card = makeMethodCard();
    const mapping = buildPaperToCodeMapping({
      methodCard: {
        ...card,
        fields: card.fields.map((field) => ({ ...field, evidenceSourceIds: [] }))
      },
      repository: {
        id: 'repo-1',
        projectId: 'local-ai-rd-workspace',
        rootPath: 'D:\\repo',
        scannedAt: '2026-07-01T00:00:00.000Z',
        techStack: ['python'],
        manifests: [],
        entryPoints: [
          { filePath: 'train_ppo.py', kind: 'train', commandCandidate: 'python train_ppo.py', reason: 'train script' }
        ],
        configFiles: [],
        risks: []
      }
    });

    expect(mapping.rows).toEqual([]);
    expect(mapping.coverage.methodConceptCount).toBe(0);
  });
});
