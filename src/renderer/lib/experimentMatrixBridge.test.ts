import { describe, expect, it } from 'vitest';
import type { EvidenceSource, MethodCard, MethodCardField, MethodCardFieldKey } from './methodCards';
import {
  buildExperimentRowsFromProjectMethodCards,
  summarizeMethodCardExperimentBridge
} from './experimentMatrixBridge';

function evidence(id: string, locator: string): EvidenceSource {
  return {
    id,
    paperId: 'paper-safe-rl',
    type: 'pdf-text',
    page: Number(locator.match(/\d+/u)?.[0] ?? 1),
    section: 'Method',
    locator,
    text: `${locator} source text`,
    score: 8
  };
}

function field(key: MethodCardFieldKey, value: string, evidenceSourceIds: string[]): MethodCardField {
  return {
    key,
    label: key,
    value,
    confidence: value ? 0.82 : 0,
    evidenceSourceIds,
    reviewState: 'unconfirmed'
  };
}

function makeCard(overrides: Partial<MethodCard> = {}): MethodCard {
  const evidenceSources = [
    evidence('ev-baseline', 'p. 6 · Experiments'),
    evidence('ev-metrics', 'p. 7 · Results'),
    evidence('ev-method', 'p. 3 · Method'),
    evidence('ev-constraints', 'p. 4 · Method')
  ];

  return {
    id: 'method-card-safe-rl',
    projectId: 'project-a',
    paperId: 'paper-safe-rl',
    title: 'Safe RL for Robot Navigation',
    status: 'needs-review',
    evidenceSources,
    fields: [
      field('modelArchitecture', 'Graph neural network policy with CBF safety filter.', ['ev-method']),
      field('constraints', 'CBF safety constraints reduce violation.', ['ev-constraints']),
      field('datasetOrEnvironment', 'Navigation tasks in dynamic clutter.', ['ev-baseline']),
      field('baseline', 'MPC and vanilla PPO baselines.', ['ev-baseline']),
      field('metrics', 'success rate, collision rate and path length.', ['ev-metrics']),
      field('claimedContribution', 'Improves safe navigation over baselines.', ['ev-method'])
    ],
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    version: 1,
    ...overrides
  };
}

describe('experiment matrix bridge', () => {
  it('builds generated rows only from method cards in the active project', () => {
    const rows = buildExperimentRowsFromProjectMethodCards([
      makeCard(),
      makeCard({ id: 'method-card-other', projectId: 'project-b', paperId: 'paper-other' })
    ], 'project-a');

    expect(rows.map((row) => row.group)).toEqual(['baseline', 'proposed', 'ablation']);
    expect(rows.every((row) => row.projectId === 'project-a')).toBe(true);
    expect(rows.every((row) => row.evidenceSourceIds.length > 0)).toBe(true);
  });

  it('summarizes available method cards, generated rows and evidence locators', () => {
    expect(summarizeMethodCardExperimentBridge([makeCard()], 'project-a')).toEqual({
      methodCardCount: 1,
      groundedMethodCardCount: 1,
      generatedRowCount: 3,
      evidenceLocatorCount: 4
    });
  });

  it('does not treat ungrounded method cards as experiment candidates', () => {
    const card = makeCard({
      id: 'method-card-empty',
      status: 'draft',
      evidenceSources: [],
      fields: [
        field('baseline', '', []),
        field('metrics', '', []),
        field('modelArchitecture', '', []),
        field('constraints', '', [])
      ]
    });

    expect(buildExperimentRowsFromProjectMethodCards([card], 'project-a')).toEqual([]);
    expect(summarizeMethodCardExperimentBridge([card], 'project-a')).toEqual({
      methodCardCount: 1,
      groundedMethodCardCount: 0,
      generatedRowCount: 0,
      evidenceLocatorCount: 0
    });
  });
});
