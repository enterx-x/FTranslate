import { describe, expect, it } from 'vitest';
import {
  METHOD_CARD_FIELD_DEFINITIONS,
  buildMethodCardFromEvidence,
  parseMethodCards,
  serializeMethodCards,
  upsertMethodCard
} from './methodCards';
import type { ExtractedPdfBlock } from './pdfTextStructure';
import type { PaperRecord } from './papers';

function makePaper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id: 'paper-safe-rl',
    pdfName: 'safe-rl.pdf',
    pdfPath: 'C:/papers/safe-rl.pdf',
    translationPath: '',
    translationName: '',
    chineseTitle: '',
    englishTitle: 'Safe Reinforcement Learning for Robot Navigation',
    authors: '',
    journal: '',
    year: '',
    notes: '',
    lastOpenedAt: '',
    lastPage: 1,
    ...overrides
  };
}

function block(partial: Partial<ExtractedPdfBlock> & Pick<ExtractedPdfBlock, 'original'>): ExtractedPdfBlock {
  const page = partial.page ?? 1;
  const type = partial.type ?? 'paragraph';
  const section = partial.section ?? 'Abstract';
  return {
    id: partial.id ?? `${page}-${type}-${section}-${partial.original.slice(0, 12)}`,
    type,
    page,
    section,
    original: partial.original,
    translation: partial.translation ?? '',
    sourceHash: partial.sourceHash ?? `${page}-${type}-${section}`
  };
}

describe('Paper-to-Method method cards', () => {
  it('builds a source-grounded method card from PDF blocks, captions and notes', () => {
    const card = buildMethodCardFromEvidence({
      projectId: 'local-ai-rd-workspace',
      paper: makePaper({
        notes: '复现风险：需要确认 CBF safety filter 的 QP 求解器和动态障碍设置。'
      }),
      blocks: [
        block({
          page: 1,
          section: 'Abstract',
          original:
            'We address safe robot navigation in dynamic clutter by combining reinforcement learning with control barrier function constraints.'
        }),
        block({
          page: 3,
          section: 'Method',
          original:
            'The policy takes lidar observations and robot state as input and outputs velocity commands through a graph neural network controller.'
        }),
        block({
          page: 4,
          section: 'Method',
          original:
            'Training optimizes a PPO objective with collision penalty and CBF safety constraints to reduce constraint violation.'
        }),
        block({
          page: 6,
          section: 'Experiments',
          original:
            'We compare against MPC and vanilla PPO baselines on navigation tasks and report success rate, collision rate and path length.'
        }),
        block({
          page: 5,
          section: 'Method',
          type: 'caption',
          original:
            'Figure 2: Overview of the graph neural network policy, CBF safety filter and velocity command output.'
        }),
        block({
          page: 7,
          section: 'Results',
          type: 'caption',
          original:
            'Table 1: Success rate and collision rate compared with MPC and PPO baselines.'
        })
      ],
      now: '2026-06-30T08:00:00.000Z'
    });

    expect(card).toMatchObject({
      projectId: 'local-ai-rd-workspace',
      paperId: 'paper-safe-rl',
      title: 'Safe Reinforcement Learning for Robot Navigation',
      status: 'needs-review',
      version: 1,
      createdAt: '2026-06-30T08:00:00.000Z',
      updatedAt: '2026-06-30T08:00:00.000Z'
    });

    expect(card.evidenceSources.map((source) => source.type)).toEqual(
      expect.arrayContaining(['pdf-text', 'figure-caption', 'table-caption', 'note'])
    );
    expect(card.evidenceSources.some((source) => source.locator === 'p. 5 · Method · Figure')).toBe(true);

    const valuesByKey = Object.fromEntries(card.fields.map((field) => [field.key, field.value]));
    expect(valuesByKey.problem).toContain('safe robot navigation');
    expect(valuesByKey.inputOutput).toContain('lidar observations');
    expect(valuesByKey.modelArchitecture).toContain('graph neural network');
    expect(valuesByKey.trainingObjective).toContain('PPO objective');
    expect(valuesByKey.constraints).toContain('CBF safety constraints');
    expect(valuesByKey.baseline).toContain('MPC and vanilla PPO baselines');
    expect(valuesByKey.metrics).toContain('success rate');
    expect(valuesByKey.reproductionRisk).toContain('QP 求解器');

    card.fields
      .filter((field) => field.value)
      .forEach((field) => {
        expect(field.evidenceSourceIds.length, `${field.key} must keep evidence`).toBeGreaterThan(0);
        expect(field.reviewState).toBe('unconfirmed');
      });
  });

  it('does not invent field values when no usable evidence exists', () => {
    const card = buildMethodCardFromEvidence({
      projectId: 'local-ai-rd-workspace',
      paper: makePaper({ id: 'paper-empty', notes: '   ' }),
      blocks: [
        block({ page: 9, section: 'References', original: '[1] A. Example. Proceedings, 2024.' }),
        block({ page: 10, section: 'Page 10', type: 'caption', original: 'Figure' })
      ],
      now: '2026-06-30T08:00:00.000Z'
    });

    expect(card.evidenceSources).toEqual([]);
    expect(card.fields).toHaveLength(METHOD_CARD_FIELD_DEFINITIONS.length);
    expect(card.fields.every((field) => field.value === '')).toBe(true);
    expect(card.fields.every((field) => field.evidenceSourceIds.length === 0)).toBe(true);
    expect(card.status).toBe('draft');
  });

  it('round-trips persisted cards and drops malformed values', () => {
    const card = buildMethodCardFromEvidence({
      projectId: 'local-ai-rd-workspace',
      paper: makePaper(),
      blocks: [
        block({
          section: 'Abstract',
          original: 'This paper proposes a robot navigation method and evaluates success rate.'
        })
      ],
      now: '2026-06-30T08:00:00.000Z'
    });

    const serialized = serializeMethodCards([card]);

    expect(parseMethodCards(serialized)).toEqual([card]);
    expect(parseMethodCards('{"bad":true}')).toEqual([]);
    expect(parseMethodCards(JSON.stringify([{ id: '', paperId: 'paper-safe-rl' }]))).toEqual([]);
  });

  it('increments version when saving a new card for the same project and paper', () => {
    const first = buildMethodCardFromEvidence({
      projectId: 'local-ai-rd-workspace',
      paper: makePaper(),
      blocks: [
        block({
          section: 'Abstract',
          original: 'This paper addresses robot navigation with a safety constraint.'
        })
      ],
      now: '2026-06-30T08:00:00.000Z'
    });
    const second = {
      ...first,
      id: 'method-card-next',
      updatedAt: '2026-06-30T09:00:00.000Z'
    };

    expect(upsertMethodCard([first], second)).toEqual([
      {
        ...second,
        id: first.id,
        createdAt: first.createdAt,
        version: 2
      }
    ]);
  });
});
