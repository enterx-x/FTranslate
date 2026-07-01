import { beforeEach, describe, expect, it } from 'vitest';
import { METHOD_CARDS_KEY, type MethodCard } from '../lib/methodCards';
import {
  filterMethodCardsByProject,
  readMethodCardsFromStorage,
  writeMethodCardsToStorage
} from './useMethodCards';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
}

function makeCard(projectId: string, paperId: string): MethodCard {
  return {
    id: `method-card-${projectId}-${paperId}`,
    projectId,
    paperId,
    title: paperId,
    status: 'needs-review',
    fields: [],
    evidenceSources: [],
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    version: 1
  };
}

describe('useMethodCards storage helpers', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('reads persisted method cards and degrades malformed storage to an empty list', () => {
    const card = makeCard('project-a', 'paper-a');
    storage.setItem(METHOD_CARDS_KEY, JSON.stringify([card]));

    const cards = readMethodCardsFromStorage(storage);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: card.id,
      projectId: 'project-a',
      paperId: 'paper-a',
      title: 'paper-a'
    });
    expect(cards[0].fields.length).toBeGreaterThan(0);

    storage.setItem(METHOD_CARDS_KEY, '{bad json');
    expect(readMethodCardsFromStorage(storage)).toEqual([]);
  });

  it('writes cards with the shared method-card storage key', () => {
    const card = makeCard('project-a', 'paper-a');

    writeMethodCardsToStorage([card], storage);

    expect(JSON.parse(storage.getItem(METHOD_CARDS_KEY) ?? '[]')).toEqual([card]);
  });

  it('filters method cards by active project without leaking other projects', () => {
    const cards = [
      makeCard('project-a', 'paper-a'),
      makeCard('project-b', 'paper-b'),
      makeCard('project-a', 'paper-c')
    ];

    expect(filterMethodCardsByProject(cards, 'project-a').map((card) => card.paperId)).toEqual([
      'paper-a',
      'paper-c'
    ]);
  });
});
