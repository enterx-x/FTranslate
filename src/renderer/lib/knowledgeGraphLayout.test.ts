import { describe, expect, it } from 'vitest';
import { layoutClusteredKnowledgeGraph } from './knowledgeGraphLayout';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from './knowledgeGraph';

function node(id: string, type: KnowledgeGraphNode['type'], count = 1): KnowledgeGraphNode {
  return {
    id,
    type,
    label: id,
    count,
    paperIds: type === 'paper' ? [id] : [],
    rowIds: []
  };
}

describe('knowledge graph clustered layout', () => {
  it('places node groups in separate canvas regions instead of one center pile', () => {
    const nodes = [
      node('paper-a', 'paper', 4),
      node('paper-b', 'paper', 2),
      node('PPO', 'method', 6),
      node('PINN', 'method', 5),
      node('路径规划', 'keyword', 7),
      node('移动机器人', 'scene', 3),
      node('success rate', 'metric', 2)
    ];
    const edges: KnowledgeGraphEdge[] = [
      { id: 'e1', source: 'paper-a', target: 'PPO', label: '方法', weight: 2 },
      { id: 'e2', source: 'paper-a', target: '路径规划', label: '关键词', weight: 2 }
    ];

    const positioned = layoutClusteredKnowledgeGraph(nodes, edges, 980, 620);
    const paper = positioned.find((item) => item.id === 'paper-a')!;
    const method = positioned.find((item) => item.id === 'PPO')!;
    const keyword = positioned.find((item) => item.id === '路径规划')!;
    const scene = positioned.find((item) => item.id === '移动机器人')!;

    expect(method.x).toBeGreaterThan(paper.x);
    expect(keyword.y).toBeLessThan(paper.y);
    expect(scene.y).toBeGreaterThan(paper.y);
    expect(new Set(positioned.map((item) => item.clusterId)).size).toBeGreaterThan(3);
  });

  it('keeps every node inside the visible canvas', () => {
    const nodes = Array.from({ length: 36 }, (_, index) =>
      node(`method-${index}`, index % 2 === 0 ? 'method' : 'keyword', index + 1)
    );
    const positioned = layoutClusteredKnowledgeGraph(nodes, [], 980, 620);

    expect(positioned.every((item) => item.x >= 28 && item.x <= 952)).toBe(true);
    expect(positioned.every((item) => item.y >= 28 && item.y <= 592)).toBe(true);
  });
});
