import type { KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphNodeType } from './knowledgeGraph';

export interface PositionedKnowledgeGraphNode extends KnowledgeGraphNode {
  x: number;
  y: number;
  radius: number;
  clusterId: string;
}

export interface KnowledgeGraphClusterRegion {
  id: string;
  title: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
}

const CLUSTER_BY_TYPE: Record<KnowledgeGraphNodeType, string> = {
  paper: 'papers',
  method: 'methods',
  keyword: 'keywords',
  scene: 'scenes',
  metric: 'metrics',
  year: 'timeline',
  venue: 'venues',
  author: 'authors',
  limitation: 'limits'
};

const CLUSTER_META: Record<string, { title: string; color: string; x: number; y: number; rx: number; ry: number }> = {
  papers: { title: '核心论文', color: '#6f5cff', x: 0.36, y: 0.5, rx: 0.16, ry: 0.2 },
  methods: { title: '方法群', color: '#3366ff', x: 0.76, y: 0.28, rx: 0.17, ry: 0.18 },
  keywords: { title: '高频关键词', color: '#a855f7', x: 0.5, y: 0.13, rx: 0.2, ry: 0.12 },
  scenes: { title: '研究场景', color: '#16a085', x: 0.76, y: 0.73, rx: 0.16, ry: 0.16 },
  metrics: { title: '评价指标', color: '#f59e0b', x: 0.32, y: 0.81, rx: 0.17, ry: 0.12 },
  timeline: { title: '年份演化', color: '#667085', x: 0.18, y: 0.22, rx: 0.11, ry: 0.13 },
  venues: { title: '期刊会议', color: '#4f46e5', x: 0.16, y: 0.65, rx: 0.12, ry: 0.14 },
  authors: { title: '作者', color: '#64748b', x: 0.14, y: 0.45, rx: 0.11, ry: 0.14 },
  limits: { title: '局限与方向', color: '#ef6c73', x: 0.52, y: 0.88, rx: 0.18, ry: 0.1 }
};

export function getKnowledgeGraphClusterRegions(
  width: number,
  height: number,
  clusterIds?: string[]
): KnowledgeGraphClusterRegion[] {
  const allowed = clusterIds ? new Set(clusterIds) : null;
  return Object.entries(CLUSTER_META)
    .filter(([id]) => !allowed || allowed.has(id))
    .map(([id, meta]) => ({
      id,
      title: meta.title,
      color: meta.color,
      x: meta.x * width,
      y: meta.y * height,
      rx: meta.rx * width,
      ry: meta.ry * height
    }));
}

export function layoutClusteredKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  width: number,
  height: number
): PositionedKnowledgeGraphNode[] {
  const nodesByCluster = new Map<string, KnowledgeGraphNode[]>();
  nodes.forEach((node) => {
    const clusterId = CLUSTER_BY_TYPE[node.type] ?? 'keywords';
    nodesByCluster.set(clusterId, [...(nodesByCluster.get(clusterId) ?? []), node]);
  });

  const positioned: PositionedKnowledgeGraphNode[] = [];
  nodesByCluster.forEach((clusterNodes, clusterId) => {
    const meta = CLUSTER_META[clusterId] ?? CLUSTER_META.keywords;
    const centerX = meta.x * width;
    const centerY = meta.y * height;
    const sortedNodes = [...clusterNodes].sort((left, right) => right.count - left.count);
    const maxRadiusX = meta.rx * width * 0.86;
    const maxRadiusY = meta.ry * height * 0.86;

    sortedNodes.forEach((node, index) => {
      const isCore = index === 0;
      const ring = Math.floor((index + 5) / 6);
      const slot = index === 0 ? 0 : index - 1;
      const slotsInRing = Math.max(6, ring * 6);
      const angle = -Math.PI / 2 + (Math.PI * 2 * slot) / slotsInRing;
      const spread = isCore ? 0 : Math.min(1, 0.34 + ring * 0.2);
      const jitter = isCore ? 0 : Math.sin(index * 1.37) * 8;
      const x = centerX + Math.cos(angle) * (maxRadiusX * spread + jitter);
      const y = centerY + Math.sin(angle) * (maxRadiusY * spread + jitter * 0.6);

      positioned.push({
        ...node,
        clusterId,
        x: clamp(x, 28, width - 28),
        y: clamp(y, 28, height - 28),
        radius: getNodeRadius(node)
      });
    });
  });

  return pullConnectedNodesSlightly(positioned, edges, width, height);
}

function getNodeRadius(node: KnowledgeGraphNode): number {
  if (node.type === 'paper') {
    return 18 + Math.min(10, node.count);
  }
  if (node.type === 'method' || node.type === 'keyword' || node.type === 'scene') {
    return 13 + Math.min(8, node.count);
  }
  return 9 + Math.min(5, node.count);
}

function pullConnectedNodesSlightly(
  nodes: PositionedKnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  width: number,
  height: number
): PositionedKnowledgeGraphNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node }]));
  edges.slice(0, 160).forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target || source.clusterId === target.clusterId) {
      return;
    }
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pull = Math.min(4, edge.weight * 0.8);
    source.x = clamp(source.x + (dx / distance) * pull, 28, width - 28);
    source.y = clamp(source.y + (dy / distance) * pull, 28, height - 28);
    target.x = clamp(target.x - (dx / distance) * pull * 0.55, 28, width - 28);
    target.y = clamp(target.y - (dy / distance) * pull * 0.55, 28, height - 28);
  });
  return [...nodeMap.values()];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
