import { useMemo, useRef, useState } from 'react';
import brandMark from '../assets/brand-mark.png';
import graphIcon from '../assets/icons/duotone/analysis.svg';
import refreshIcon from '../assets/icons/duotone/refresh.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import homeIcon from '../assets/icons/duotone/home.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import {
  buildKnowledgeGraph,
  type KnowledgeGraphData,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeType
} from '../lib/knowledgeGraph';
import type { PaperRecord } from '../lib/papers';
import { getResearchRowValues, type ResearchSheetLink, type ResearchWorkbook } from '../lib/researchWorkbook';

interface KnowledgeGraphPageProps {
  papers: PaperRecord[];
  workbook: ResearchWorkbook;
  links: ResearchSheetLink[];
  onBackHome: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onOpenResearchSheet: (paper?: PaperRecord) => void;
}

type GraphSource = 'merged' | 'workbook' | 'library';
type GraphKind = 'all' | 'paper-method' | 'topic' | 'author' | 'timeline';

interface PositionedNode extends KnowledgeGraphNode {
  x: number;
  y: number;
}

const NODE_TYPE_OPTIONS: Array<{ value: KnowledgeGraphNodeType; label: string }> = [
  { value: 'paper', label: '论文' },
  { value: 'author', label: '作者' },
  { value: 'year', label: '年份' },
  { value: 'venue', label: '期刊/会议' },
  { value: 'keyword', label: '关键词' },
  { value: 'method', label: '方法' },
  { value: 'scene', label: '场景' },
  { value: 'metric', label: '指标' },
  { value: 'limitation', label: '局限' }
];

const GRAPH_KIND_TYPES: Record<GraphKind, KnowledgeGraphNodeType[]> = {
  all: NODE_TYPE_OPTIONS.map((option) => option.value),
  'paper-method': ['paper', 'method', 'metric', 'scene'],
  topic: ['paper', 'keyword', 'method', 'scene'],
  author: ['paper', 'author', 'venue', 'year'],
  timeline: ['paper', 'year', 'venue', 'method']
};

const NODE_COLORS: Record<KnowledgeGraphNodeType, string> = {
  paper: '#111827',
  author: '#5b6bff',
  year: '#0f766e',
  venue: '#7c3aed',
  keyword: '#2563eb',
  method: '#db2777',
  scene: '#0891b2',
  metric: '#ea580c',
  limitation: '#64748b'
};

export function KnowledgeGraphPage(props: KnowledgeGraphPageProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [source, setSource] = useState<GraphSource>('merged');
  const [graphKind, setGraphKind] = useState<GraphKind>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<KnowledgeGraphNodeType[]>(GRAPH_KIND_TYPES.all);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const graph = useMemo(
    () => buildKnowledgeGraph({ papers: props.papers, workbook: props.workbook, links: props.links, source }),
    [props.papers, props.workbook, props.links, source]
  );
  const filteredGraph = useMemo(
    () => filterGraph(graph, selectedTypes, searchText, graphKind),
    [graph, selectedTypes, searchText, graphKind]
  );
  const positionedNodes = useMemo(() => layoutGraph(filteredGraph.nodes, 920, 560), [filteredGraph.nodes]);
  const positionedNodeMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const selectedNode = positionedNodeMap.get(selectedNodeId) ?? positionedNodes[0] ?? null;

  function resetFilters(): void {
    setSource('merged');
    setGraphKind('all');
    setSearchText('');
    setSelectedTypes(GRAPH_KIND_TYPES.all);
    setSelectedNodeId('');
  }

  function handleGraphKindChange(nextKind: GraphKind): void {
    setGraphKind(nextKind);
    setSelectedTypes(GRAPH_KIND_TYPES[nextKind]);
    setSelectedNodeId('');
  }

  function toggleNodeType(type: KnowledgeGraphNodeType): void {
    setSelectedTypes((types) =>
      types.includes(type) ? types.filter((item) => item !== type) : [...types, type]
    );
    setSelectedNodeId('');
  }

  function exportJson(): void {
    void navigator.clipboard.writeText(JSON.stringify(filteredGraph, null, 2));
  }

  function exportSvg(): void {
    const svg = svgRef.current;
    if (!svg) return;
    const content = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ftranslate-knowledge-graph.svg';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="knowledge-graph-page">
      <header className="knowledge-graph-header">
        <div className="page-title-block">
          <img src={brandMark} alt="" />
          <div>
            <span className="eyebrow">Knowledge Graph</span>
            <h1>知识图谱</h1>
            <p>根据研究表格和论文库自动生成文献主题、方法、作者和年份关系。</p>
          </div>
        </div>
        <div className="page-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={resetFilters}>
            <img className="button-icon" src={refreshIcon} alt="" />
            <span>重置筛选</span>
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={exportSvg}>
            <img className="button-icon" src={downloadIcon} alt="" />
            <span>导出图片</span>
          </button>
          <button type="button" className="secondary-button" onClick={exportJson}>
            导出 JSON
          </button>
          <button type="button" className="button-with-icon" onClick={props.onBackHome}>
            <img className="button-icon" src={homeIcon} alt="" />
            <span>主页</span>
          </button>
        </div>
      </header>

      <section className="knowledge-graph-layout">
        <aside className="knowledge-filter-panel">
          <strong className="panel-title-with-icon">
            <img className="panel-title-icon" src={graphIcon} alt="" />
            图谱筛选
          </strong>
          <label>
            数据来源
            <select value={source} onChange={(event) => setSource(event.target.value as GraphSource)}>
              <option value="merged">研究表格 + 论文库</option>
              <option value="workbook">当前研究表格</option>
              <option value="library">论文库</option>
            </select>
          </label>
          <label>
            图谱类型
            <select value={graphKind} onChange={(event) => handleGraphKindChange(event.target.value as GraphKind)}>
              <option value="all">全量图谱</option>
              <option value="paper-method">论文-方法图谱</option>
              <option value="topic">主题关系图谱</option>
              <option value="author">作者-论文图谱</option>
              <option value="timeline">年份演化图谱</option>
            </select>
          </label>
          <label>
            搜索节点
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="论文、方法、关键词..." />
          </label>
          <div className="node-type-filter">
            {NODE_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={selectedTypes.includes(option.value) ? 'active' : ''}
                onClick={() => toggleNodeType(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="graph-stat-grid">
            <span><strong>{filteredGraph.stats.paperCount}</strong>论文</span>
            <span><strong>{filteredGraph.nodes.length}</strong>节点</span>
            <span><strong>{filteredGraph.edges.length}</strong>边</span>
          </div>
          <div className="graph-keywords">
            <small>高频方法</small>
            <p>{graph.stats.topMethods.join(' / ') || '暂无'}</p>
            <small>高频关键词</small>
            <p>{graph.stats.topKeywords.join(' / ') || '暂无'}</p>
          </div>
        </aside>

        <section className="knowledge-canvas-card">
          {positionedNodes.length === 0 ? (
            <div className="empty-state">
              <img className="empty-state-icon" src={graphIcon} alt="" />
              <h2>暂无可生成的图谱数据</h2>
              <p>请先在论文库中加入论文，或在研究表格中录入关键词、方法、场景和指标。</p>
            </div>
          ) : (
            <svg ref={svgRef} className="knowledge-graph-svg" viewBox="0 0 920 560" role="img" aria-label="文献知识图谱">
              <rect width="920" height="560" rx="18" fill="#fbfcff" />
              {filteredGraph.edges.map((edge) => {
                const sourceNode = positionedNodeMap.get(edge.source);
                const targetNode = positionedNodeMap.get(edge.target);
                if (!sourceNode || !targetNode) return null;
                return (
                  <line
                    key={edge.id}
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke="#c8d1df"
                    strokeWidth={Math.min(3, 0.8 + edge.weight * 0.35)}
                    opacity="0.68"
                  />
                );
              })}
              {positionedNodes.map((node) => (
                <g
                  key={node.id}
                  className={`knowledge-node ${selectedNode?.id === node.id ? 'is-selected' : ''}`}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <circle
                    r={node.type === 'paper' ? 18 : 11 + Math.min(8, node.count)}
                    fill={NODE_COLORS[node.type]}
                    opacity={node.type === 'paper' ? '0.96' : '0.84'}
                  />
                  <text x={node.type === 'paper' ? 24 : 18} y="4">
                    {truncateLabel(node.label, node.type === 'paper' ? 24 : 18)}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </section>

        <aside className="knowledge-detail-panel">
          <GraphNodeDetails
            node={selectedNode}
            graph={filteredGraph}
            papers={props.papers}
            workbook={props.workbook}
            links={props.links}
            onOpenPaper={props.onOpenPaper}
            onOpenResearchSheet={props.onOpenResearchSheet}
          />
        </aside>
      </section>
    </main>
  );
}

function GraphNodeDetails(props: {
  node: KnowledgeGraphNode | null;
  graph: KnowledgeGraphData;
  papers: PaperRecord[];
  workbook: ResearchWorkbook;
  links: ResearchSheetLink[];
  onOpenPaper: (paper: PaperRecord) => void;
  onOpenResearchSheet: (paper?: PaperRecord) => void;
}) {
  if (!props.node) {
    return (
      <div className="empty-state compact">
        <h2>选择一个节点</h2>
        <p>点击图中的论文、方法、关键词或作者节点，可查看相关论文和表格行信息。</p>
      </div>
    );
  }

  const relatedPapers = props.node.paperIds
    .map((paperId) => props.papers.find((paper) => paper.id === paperId))
    .filter((paper): paper is PaperRecord => Boolean(paper));
  const rowId = props.node.rowIds[0] ?? '';
  const rowIndex = props.workbook.rows.findIndex((row) => row.id === rowId);
  const rowValues = rowIndex > 0 ? getResearchRowValues(props.workbook, rowIndex) : null;

  return (
    <div className="knowledge-node-detail">
      <span className="badge">{NODE_TYPE_OPTIONS.find((option) => option.value === props.node?.type)?.label}</span>
      <h2>{props.node.label}</h2>
      <p>{props.node.count > 1 ? `出现 ${props.node.count} 次` : '单次出现'}</p>
      {relatedPapers.length > 0 ? (
        <section>
          <strong>相关论文</strong>
          <div className="related-paper-list">
            {relatedPapers.map((paper) => (
              <button key={paper.id} type="button" onClick={() => props.onOpenPaper(paper)}>
                <img className="button-icon" src={pdfReaderIcon} alt="" />
                <span>{paper.chineseTitle || paper.englishTitle || paper.pdfName}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {rowValues ? (
        <section>
          <strong>对应表格行</strong>
          <div className="row-detail-list">
            {Object.entries(rowValues).map(([key, value]) =>
              value.trim() ? (
                <p key={key}>
                  <span>{key}</span>
                  <em>{value}</em>
                </p>
              ) : null
            )}
          </div>
          <button
            type="button"
            className="secondary-button button-with-icon"
            onClick={() => props.onOpenResearchSheet(relatedPapers[0])}
          >
            <img className="button-icon" src={researchSheetIcon} alt="" />
            <span>跳转研究表格</span>
          </button>
        </section>
      ) : null}
      {props.node.type !== 'paper' ? (
        <section>
          <strong>连接关系</strong>
          <p className="subtle">
            {
              props.graph.edges.filter((edge) => edge.source === props.node?.id || edge.target === props.node?.id)
                .length
            } 条边与该节点相关。
          </p>
        </section>
      ) : null}
    </div>
  );
}

function filterGraph(
  graph: KnowledgeGraphData,
  selectedTypes: KnowledgeGraphNodeType[],
  searchText: string,
  graphKind: GraphKind
): KnowledgeGraphData {
  const allowedTypes = new Set(selectedTypes.length > 0 ? selectedTypes : GRAPH_KIND_TYPES[graphKind]);
  const query = searchText.trim().toLowerCase();
  const nodes = graph.nodes.filter(
    (node) => allowedTypes.has(node.type) && (!query || node.label.toLowerCase().includes(query))
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return {
    nodes,
    edges,
    stats: {
      paperCount: nodes.filter((node) => node.type === 'paper').length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      topKeywords: graph.stats.topKeywords,
      topMethods: graph.stats.topMethods
    }
  };
}

function layoutGraph(nodes: KnowledgeGraphNode[], width: number, height: number): PositionedNode[] {
  const paperNodes = nodes.filter((node) => node.type === 'paper');
  const otherNodes = nodes.filter((node) => node.type !== 'paper');
  const centerX = width / 2;
  const centerY = height / 2;
  const paperRadius = Math.min(width, height) * 0.18;
  const outerRadius = Math.min(width, height) * 0.38;

  return [
    ...paperNodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, paperNodes.length) - Math.PI / 2;
      return {
        ...node,
        x: centerX + Math.cos(angle) * paperRadius,
        y: centerY + Math.sin(angle) * paperRadius
      };
    }),
    ...otherNodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, otherNodes.length) - Math.PI / 2;
      const typeOffset = NODE_TYPE_OPTIONS.findIndex((option) => option.value === node.type) * 7;
      return {
        ...node,
        x: centerX + Math.cos(angle) * (outerRadius + (typeOffset % 28)),
        y: centerY + Math.sin(angle) * (outerRadius + (typeOffset % 28))
      };
    })
  ];
}

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
}
