import type { PaperRecord } from './papers';
import {
  getResearchCellText,
  getResearchRowValues,
  type ResearchSheetLink,
  type ResearchWorkbook
} from './researchWorkbook';

export type KnowledgeGraphNodeType =
  | 'paper'
  | 'author'
  | 'year'
  | 'venue'
  | 'keyword'
  | 'method'
  | 'scene'
  | 'metric'
  | 'limitation';

export interface KnowledgeGraphNode {
  id: string;
  type: KnowledgeGraphNodeType;
  label: string;
  count: number;
  paperIds: string[];
  rowIds: string[];
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: {
    paperCount: number;
    nodeCount: number;
    edgeCount: number;
    topKeywords: string[];
    topMethods: string[];
  };
}

export interface BuildKnowledgeGraphInput {
  papers: PaperRecord[];
  workbook: ResearchWorkbook;
  links: ResearchSheetLink[];
  source?: 'workbook' | 'library' | 'merged';
  maxNodes?: number;
}

interface GraphPaperEntry {
  id: string;
  rowId: string;
  rowIndex: number;
  title: string;
  chineseTitle: string;
  englishTitle: string;
  authors: string;
  year: string;
  venue: string;
  keywords: string;
  methods: string;
  scenes: string;
  metrics: string;
  limitations: string;
}

const FIELD_ALIASES = {
  chineseTitle: ['中文标题', '题名', '标题', 'Chinese Title'],
  englishTitle: ['英文标题', 'English Title', 'Title'],
  authors: ['作者', 'Authors', 'Author'],
  year: ['年份', 'Year'],
  venue: ['期刊/会议', '期刊', '会议', '来源', 'Journal', 'Conference', 'Venue'],
  keywords: ['关键词', '关键字', 'Keywords', 'Keyword'],
  methods: ['方法', '研究方法', '算法', 'RL算法', 'PINN融合方式', 'Method', 'Algorithm'],
  scenes: ['研究场景', '场景', '环境类型', '任务', '应用场景', 'Scenario', 'Environment', 'Task'],
  metrics: ['评价指标', '指标/结果', '指标', '结果', 'Metrics', 'Result'],
  limitations: ['局限点', '局限性', '未来方向', '疑问', 'Limitations', 'Future Work']
} as const;

const METHOD_HINTS = [
  'PPO',
  'SAC',
  'DDPG',
  'TD3',
  'DQN',
  'RL',
  'PINN',
  'CBF',
  'MPC',
  'VLM',
  'World Model',
  'Transformer',
  'Diffusion',
  'PID',
  'QP',
  'RRT',
  'A*',
  'MCTS'
];

export function buildKnowledgeGraph(input: BuildKnowledgeGraphInput): KnowledgeGraphData {
  const entries = buildPaperEntries(input);
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();

  entries.forEach((entry) => {
    const paperNode = ensureNode(nodes, {
      id: `paper:${entry.id}`,
      type: 'paper',
      label: entry.title,
      paperId: entry.id,
      rowId: entry.rowId
    });

    addValueNodes(nodes, edges, paperNode, 'author', splitPeople(entry.authors), '作者');
    addValueNodes(nodes, edges, paperNode, 'year', splitValues(entry.year), '年份');
    addValueNodes(nodes, edges, paperNode, 'venue', splitValues(entry.venue), '期刊/会议');
    addValueNodes(nodes, edges, paperNode, 'keyword', splitValues(entry.keywords), '关键词');
    addValueNodes(nodes, edges, paperNode, 'method', extractMethods(entry), '方法');
    addValueNodes(nodes, edges, paperNode, 'scene', splitValues(entry.scenes), '场景');
    addValueNodes(nodes, edges, paperNode, 'metric', splitValues(entry.metrics), '指标');
    addValueNodes(nodes, edges, paperNode, 'limitation', splitValues(entry.limitations).slice(0, 3), '局限');
  });

  addCoOccurrenceEdges(nodes, edges, 'method', '共现方法');
  addCoOccurrenceEdges(nodes, edges, 'keyword', '共现关键词');

  const sortedNodes = [...nodes.values()].sort((left, right) => {
    if (left.type === 'paper' && right.type !== 'paper') return -1;
    if (left.type !== 'paper' && right.type === 'paper') return 1;
    return right.count - left.count || left.label.localeCompare(right.label);
  });
  const limitedNodeIds = new Set(sortedNodes.slice(0, input.maxNodes ?? 120).map((node) => node.id));
  const limitedNodes = sortedNodes.filter((node) => limitedNodeIds.has(node.id));
  const limitedEdges = [...edges.values()].filter(
    (edge) => limitedNodeIds.has(edge.source) && limitedNodeIds.has(edge.target)
  );

  return {
    nodes: limitedNodes,
    edges: limitedEdges,
    stats: {
      paperCount: entries.length,
      nodeCount: limitedNodes.length,
      edgeCount: limitedEdges.length,
      topKeywords: getTopLabels(limitedNodes, 'keyword'),
      topMethods: getTopLabels(limitedNodes, 'method')
    }
  };
}

function buildPaperEntries(input: BuildKnowledgeGraphInput): GraphPaperEntry[] {
  const source = input.source ?? 'merged';
  const paperById = new Map(input.papers.map((paper) => [paper.id, paper]));
  const entries: GraphPaperEntry[] = [];

  if (source !== 'library') {
    input.workbook.rows.slice(1).forEach((row, offset) => {
      const rowIndex = offset + 1;
      const rowValues = getResearchRowValues(input.workbook, rowIndex);
      const link = input.links.find((item) => item.rowId === row.id);
      const paper = link ? paperById.get(link.paperId) : undefined;
      const firstCell = getResearchCellText(input.workbook, rowIndex, 0);
      const chineseTitle = pickField(rowValues, FIELD_ALIASES.chineseTitle) || paper?.chineseTitle || firstCell;
      const englishTitle = pickField(rowValues, FIELD_ALIASES.englishTitle) || paper?.englishTitle || '';
      const title = chineseTitle || englishTitle || paper?.pdfName || firstCell;
      if (!title.trim()) {
        return;
      }

      entries.push({
        id: paper?.id ?? `row:${row.id}`,
        rowId: row.id,
        rowIndex,
        title: title.trim(),
        chineseTitle,
        englishTitle,
        authors: pickField(rowValues, FIELD_ALIASES.authors) || paper?.authors || '',
        year: pickField(rowValues, FIELD_ALIASES.year) || paper?.year || '',
        venue: pickField(rowValues, FIELD_ALIASES.venue) || paper?.journal || '',
        keywords: pickField(rowValues, FIELD_ALIASES.keywords),
        methods: pickField(rowValues, FIELD_ALIASES.methods),
        scenes: pickField(rowValues, FIELD_ALIASES.scenes),
        metrics: pickField(rowValues, FIELD_ALIASES.metrics),
        limitations: pickField(rowValues, FIELD_ALIASES.limitations)
      });
    });
  }

  if (source !== 'workbook') {
    input.papers.forEach((paper) => {
      if (entries.some((entry) => entry.id === paper.id)) {
        return;
      }
      entries.push({
        id: paper.id,
        rowId: '',
        rowIndex: -1,
        title: paper.chineseTitle || paper.englishTitle || paper.pdfName,
        chineseTitle: paper.chineseTitle,
        englishTitle: paper.englishTitle,
        authors: paper.authors,
        year: paper.year,
        venue: paper.journal,
        keywords: '',
        methods: paper.notes,
        scenes: '',
        metrics: '',
        limitations: paper.notes
      });
    });
  }

  return entries;
}

function pickField(values: Record<string, string>, aliases: readonly string[]): string {
  const entries = Object.entries(values);
  for (const alias of aliases) {
    const normalizedAlias = normalizeLabel(alias);
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedAlias);
    if (exact?.[1]?.trim()) {
      return exact[1].trim();
    }
    const fuzzy = entries.find(([key]) => normalizeLabel(key).includes(normalizedAlias));
    if (fuzzy?.[1]?.trim()) {
      return fuzzy[1].trim();
    }
  }
  return '';
}

function addValueNodes(
  nodes: Map<string, KnowledgeGraphNode>,
  edges: Map<string, KnowledgeGraphEdge>,
  paperNode: KnowledgeGraphNode,
  type: KnowledgeGraphNodeType,
  values: string[],
  label: string
): void {
  values.slice(0, type === 'author' ? 8 : 10).forEach((value) => {
    const node = ensureNode(nodes, {
      id: `${type}:${normalizeNodeId(value)}`,
      type,
      label: value,
      paperId: paperNode.paperIds[0] ?? '',
      rowId: paperNode.rowIds[0] ?? ''
    });
    addEdge(edges, paperNode.id, node.id, label);
  });
}

function ensureNode(
  nodes: Map<string, KnowledgeGraphNode>,
  input: { id: string; type: KnowledgeGraphNodeType; label: string; paperId: string; rowId: string }
): KnowledgeGraphNode {
  const existing = nodes.get(input.id);
  if (existing) {
    existing.count += 1;
    if (input.paperId && !existing.paperIds.includes(input.paperId)) existing.paperIds.push(input.paperId);
    if (input.rowId && !existing.rowIds.includes(input.rowId)) existing.rowIds.push(input.rowId);
    return existing;
  }

  const node: KnowledgeGraphNode = {
    id: input.id,
    type: input.type,
    label: input.label,
    count: 1,
    paperIds: input.paperId ? [input.paperId] : [],
    rowIds: input.rowId ? [input.rowId] : []
  };
  nodes.set(node.id, node);
  return node;
}

function addEdge(edges: Map<string, KnowledgeGraphEdge>, source: string, target: string, label: string): void {
  if (source === target) return;
  const [left, right] = source < target ? [source, target] : [target, source];
  const id = `${left}->${right}:${label}`;
  const existing = edges.get(id);
  if (existing) {
    existing.weight += 1;
    return;
  }
  edges.set(id, { id, source, target, label, weight: 1 });
}

function addCoOccurrenceEdges(
  nodes: Map<string, KnowledgeGraphNode>,
  edges: Map<string, KnowledgeGraphEdge>,
  type: KnowledgeGraphNodeType,
  label: string
): void {
  const typedNodes = [...nodes.values()].filter((node) => node.type === type && node.paperIds.length > 1);
  typedNodes.forEach((node, index) => {
    typedNodes.slice(index + 1).forEach((other) => {
      const sharedPaperCount = node.paperIds.filter((paperId) => other.paperIds.includes(paperId)).length;
      if (sharedPaperCount > 0) {
        addEdge(edges, node.id, other.id, label);
      }
    });
  });
}

function extractMethods(entry: GraphPaperEntry): string[] {
  const source = [entry.methods, entry.keywords, entry.englishTitle, entry.chineseTitle].join(' ');
  const hinted = METHOD_HINTS.filter((hint) => new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(hint)}([^A-Za-z0-9]|$)`, 'iu').test(source));
  return uniqueValues([...hinted, ...splitValues(entry.methods)]);
}

function splitPeople(value: string): string[] {
  return splitValues(value)
    .map((item) => item.replace(/\bet\s+al\.?/iu, '').trim())
    .filter(Boolean);
}

function splitValues(value: string): string[] {
  return uniqueValues(
    value
      .split(/[;；,，、\n/|]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 60)
      .filter((item) => !/^(none|n\/a|null|无|暂无|-+)$/iu.test(item))
  );
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeNodeId(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTopLabels(nodes: KnowledgeGraphNode[], type: KnowledgeGraphNodeType): string[] {
  return nodes
    .filter((node) => node.type === type)
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
    .map((node) => node.label);
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, '').replace(/[：:]/gu, '');
}

function normalizeNodeId(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/gu, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
