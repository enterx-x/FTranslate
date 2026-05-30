import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react';
import graphIcon from '../assets/icons/duotone/analysis.svg';
import refreshIcon from '../assets/icons/duotone/refresh.svg';
import downloadIcon from '../assets/icons/duotone/download.svg';
import homeIcon from '../assets/icons/duotone/home.svg';
import pdfReaderIcon from '../assets/icons/duotone/pdf-reader.svg';
import researchSheetIcon from '../assets/icons/duotone/research-sheet.svg';
import {
  buildKnowledgeGraph,
  downloadKnowledgeGraphJson,
  type KnowledgeGraphData,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeType
} from '../lib/knowledgeGraph';
import type { PaperRecord } from '../lib/papers';
import { getResearchRowValues, type ResearchSheetLink, type ResearchWorkbook } from '../lib/researchWorkbook';
import { MarkdownDocument } from './MarkdownDocument';

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
type LabelStrategy = 'core' | 'hover' | 'all';

interface PositionedNode extends KnowledgeGraphNode {
  x: number;
  y: number;
  radius: number;
}

interface GraphTransform {
  scale: number;
  x: number;
  y: number;
}

interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

const NODE_TYPE_OPTIONS: Array<{ value: KnowledgeGraphNodeType; label: string }> = [
  { value: 'paper', label: '论文' },
  { value: 'method', label: '方法' },
  { value: 'keyword', label: '关键词' },
  { value: 'scene', label: '场景' },
  { value: 'metric', label: '指标' },
  { value: 'year', label: '年份' },
  { value: 'venue', label: '期刊/会议' },
  { value: 'author', label: '作者' },
  { value: 'limitation', label: '局限性' }
];

const GRAPH_KIND_TYPES: Record<GraphKind, KnowledgeGraphNodeType[]> = {
  all: NODE_TYPE_OPTIONS.map((option) => option.value),
  'paper-method': ['paper', 'method', 'metric', 'scene', 'year'],
  topic: ['paper', 'keyword', 'method', 'scene'],
  author: ['paper', 'author', 'venue', 'year'],
  timeline: ['paper', 'year', 'venue', 'method']
};

const NODE_STYLE: Record<KnowledgeGraphNodeType, { color: string; soft: string }> = {
  paper: { color: '#6f5cff', soft: '#f0edff' },
  method: { color: '#3366ff', soft: '#eef3ff' },
  keyword: { color: '#a855f7', soft: '#f7efff' },
  scene: { color: '#16a085', soft: '#ecfdf7' },
  metric: { color: '#f59e0b', soft: '#fff7e6' },
  year: { color: '#667085', soft: '#f3f5f8' },
  venue: { color: '#4f46e5', soft: '#eef2ff' },
  author: { color: '#64748b', soft: '#f1f5f9' },
  limitation: { color: '#ef6c73', soft: '#fff1f2' }
};

const DEFAULT_TRANSFORM: GraphTransform = { scale: 1, x: 0, y: 0 };

export function KnowledgeGraphPage(props: KnowledgeGraphPageProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [source, setSource] = useState<GraphSource>('merged');
  const [graphKind, setGraphKind] = useState<GraphKind>('paper-method');
  const [searchText, setSearchText] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<KnowledgeGraphNodeType[]>(GRAPH_KIND_TYPES['paper-method']);
  const [maxNodes, setMaxNodes] = useState(80);
  const [labelStrategy, setLabelStrategy] = useState<LabelStrategy>('core');
  const [showEdges, setShowEdges] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [hoveredNodeId, setHoveredNodeId] = useState<string>('');
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([]);
  const [transform, setTransform] = useState<GraphTransform>(DEFAULT_TRANSFORM);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isCanvasFull, setIsCanvasFull] = useState(false);

  const graph = useMemo(
    () => buildKnowledgeGraph({ papers: props.papers, workbook: props.workbook, links: props.links, source, maxNodes: 180 }),
    [props.papers, props.workbook, props.links, source]
  );
  const filteredGraph = useMemo(
    () => filterGraph(graph, selectedTypes, searchText, graphKind, maxNodes, hiddenNodeIds),
    [graph, selectedTypes, searchText, graphKind, maxNodes, hiddenNodeIds]
  );
  const positionedNodes = useMemo(
    () => layoutNeuronGraph(filteredGraph.nodes, filteredGraph.edges, 920, 560),
    [filteredGraph.nodes, filteredGraph.edges]
  );
  const nodeMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const selectedNode = nodeMap.get(selectedNodeId) ?? positionedNodes[0] ?? null;
  const activeNodeId = hoveredNodeId || selectedNode?.id || '';
  const neighborIds = useMemo(() => getNeighborIds(filteredGraph.edges, activeNodeId), [filteredGraph.edges, activeNodeId]);
  const visibleEdges = showEdges ? filteredGraph.edges : [];

  function resetFilters(): void {
    setSource('merged');
    setGraphKind('paper-method');
    setSearchText('');
    setSelectedTypes(GRAPH_KIND_TYPES['paper-method']);
    setHiddenNodeIds([]);
    setMaxNodes(80);
    setLabelStrategy('core');
    setTransform(DEFAULT_TRANSFORM);
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
    downloadKnowledgeGraphJson(filteredGraph);
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

  function fitCanvas(): void {
    setTransform(DEFAULT_TRANSFORM);
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.08 : 0.08;
    setTransform((current) => ({
      ...current,
      scale: Math.min(2.2, Math.max(0.55, Number((current.scale + direction).toFixed(2))))
    }));
  }

  function handlePanStart(event: ReactPointerEvent<SVGSVGElement>): void {
    if ((event.target as Element).closest('.knowledge-node')) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startTransform = transform;
    const move = (moveEvent: PointerEvent) => {
      setTransform({
        ...startTransform,
        x: startTransform.x + moveEvent.clientX - startX,
        y: startTransform.y + moveEvent.clientY - startY
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function handleNodeContextMenu(event: ReactMouseEvent<SVGGElement>, nodeId: string): void {
    event.preventDefault();
    setContextMenu({ nodeId, x: event.clientX, y: event.clientY });
    setSelectedNodeId(nodeId);
  }

  return (
    <main className="knowledge-graph-page">
      <header className="knowledge-graph-header">
        <div className="page-title-block">
          <img className="panel-title-icon" src={graphIcon} alt="" />
          <div>
            <span className="eyebrow">Knowledge Graph</span>
            <h1>知识图谱</h1>
            <p>根据研究表格和论文库自动生成文献主题、方法、作者和年份关系网络。</p>
          </div>
        </div>
        <div className="page-header-actions">
          <button type="button" className="secondary-button button-with-icon" onClick={resetFilters}>
            <img className="button-icon" src={refreshIcon} alt="" />
            <span>重新生成</span>
          </button>
          <button type="button" className="secondary-button" onClick={fitCanvas}>
            适应画布
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

      <section className={`knowledge-graph-layout${isCanvasFull ? ' canvas-fullscreen' : ''}`}>
        <aside className="knowledge-filter-panel">
          <strong className="panel-title-with-icon">
            <img className="panel-title-icon" src={graphIcon} alt="" />
            图谱控制
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
              <option value="topic">论文-关键词图谱</option>
              <option value="author">论文-作者图谱</option>
              <option value="timeline">年份演化图谱</option>
            </select>
          </label>
          <label>
            搜索节点
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="论文、方法、关键词、作者..." />
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
          <div className="graph-display-controls">
            <label>
              最大节点数
              <select value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))}>
                <option value={50}>50</option>
                <option value={80}>80</option>
                <option value={120}>120</option>
                <option value={180}>180</option>
              </select>
            </label>
            <label>
              标签显示
              <select value={labelStrategy} onChange={(event) => setLabelStrategy(event.target.value as LabelStrategy)}>
                <option value="core">核心节点</option>
                <option value="hover">悬停/选中邻居</option>
                <option value="all">全部显示</option>
              </select>
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={showEdges} onChange={(event) => setShowEdges(event.target.checked)} />
              <span>显示边</span>
            </label>
          </div>
          <div className="graph-stat-grid">
            <span><strong>{filteredGraph.stats.paperCount}</strong>论文</span>
            <span><strong>{filteredGraph.nodes.length}</strong>节点</span>
            <span><strong>{filteredGraph.edges.length}</strong>边</span>
            <span><strong>{graph.stats.topMethods.length}</strong>高频方法</span>
          </div>
          <div className="graph-keywords">
            <small>高频方法</small>
            <p>{graph.stats.topMethods.join(' / ') || '暂无'}</p>
            <small>高频关键词</small>
            <p>{graph.stats.topKeywords.join(' / ') || '暂无'}</p>
          </div>
          {filteredGraph.nodes.length >= maxNodes ? (
            <p className="inline-message">当前图谱节点较多，建议使用筛选器缩小范围。</p>
          ) : null}
        </aside>

        <section className="knowledge-canvas-card">
          <div className="knowledge-canvas-toolbar">
            <div className="graph-legend">
              {NODE_TYPE_OPTIONS.slice(0, 6).map((option) => (
                <span key={option.value}>
                  <i style={{ background: NODE_STYLE[option.value].color }} />
                  {option.label}
                </span>
              ))}
            </div>
            <div>
              <button type="button" className="icon-button" onClick={() => setTransform((value) => ({ ...value, scale: Math.max(0.55, value.scale - 0.1) }))} title="缩小">
                -
              </button>
              <button type="button" className="icon-button" onClick={() => setTransform((value) => ({ ...value, scale: Math.min(2.2, value.scale + 0.1) }))} title="放大">
                +
              </button>
              <button type="button" className="secondary-button" onClick={() => setIsCanvasFull((value) => !value)}>
                {isCanvasFull ? '退出放大' : '放大查看'}
              </button>
            </div>
          </div>
          {positionedNodes.length === 0 ? (
            <div className="empty-state">
              <img className="empty-state-icon" src={graphIcon} alt="" />
              <h2>暂无可生成的图谱数据</h2>
              <p>请先在论文库中加入论文，或在研究表格中录入关键词、方法、场景和指标。</p>
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="knowledge-graph-svg"
              viewBox="0 0 920 560"
              role="img"
              aria-label="文献知识图谱"
              onWheel={handleWheel}
              onPointerDown={handlePanStart}
              onClick={() => setContextMenu(null)}
            >
              <defs>
                <filter id="neuron-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect width="920" height="560" rx="18" fill="#fbfcff" />
              <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                {visibleEdges.map((edge) => {
                  const sourceNode = nodeMap.get(edge.source);
                  const targetNode = nodeMap.get(edge.target);
                  if (!sourceNode || !targetNode) return null;
                  const isActive = activeNodeId && (edge.source === activeNodeId || edge.target === activeNodeId);
                  return (
                    <path
                      key={edge.id}
                      d={buildCurvePath(sourceNode, targetNode)}
                      className={isActive ? 'graph-edge is-active' : 'graph-edge'}
                      strokeWidth={Math.min(3, 0.7 + edge.weight * 0.22)}
                    />
                  );
                })}
                {positionedNodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  const isHovered = hoveredNodeId === node.id;
                  const isNeighbor = neighborIds.has(node.id);
                  const dimmed = activeNodeId && !isSelected && !isHovered && !isNeighbor && node.id !== activeNodeId;
                  const showLabel = shouldShowLabel(node, isSelected, isHovered, isNeighbor, labelStrategy);
                  return (
                    <g
                      key={node.id}
                      className={`knowledge-node ${isSelected ? 'is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
                      transform={`translate(${node.x}, ${node.y})`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedNodeId(node.id);
                        setContextMenu(null);
                      }}
                      onDoubleClick={() => openNode(node, props.papers, props.onOpenPaper)}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId('')}
                      onContextMenu={(event) => handleNodeContextMenu(event, node.id)}
                    >
                      <circle r={node.radius + 10} fill={NODE_STYLE[node.type].soft} opacity="0.82" />
                      <circle
                        r={node.radius}
                        fill={NODE_STYLE[node.type].color}
                        filter={node.type === 'paper' || isSelected ? 'url(#neuron-glow)' : undefined}
                      />
                      {node.type === 'paper' ? (
                        <text className="node-count" y="5" textAnchor="middle">{node.count}</text>
                      ) : null}
                      {showLabel ? (
                        <text x={node.radius + 10} y="4">
                          {truncateLabel(node.label, node.type === 'paper' ? 26 : 18)}
                        </text>
                      ) : null}
                      <title>{node.label}</title>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          {contextMenu ? (
            <GraphContextMenu
              state={contextMenu}
              node={nodeMap.get(contextMenu.nodeId) ?? null}
              papers={props.papers}
              onClose={() => setContextMenu(null)}
              onOpenPaper={props.onOpenPaper}
              onOpenResearchSheet={props.onOpenResearchSheet}
              onHideNode={(nodeId) => setHiddenNodeIds((ids) => [...ids, nodeId])}
              onFocusNode={(nodeId) => {
                const node = nodeMap.get(nodeId);
                if (node) setTransform({ scale: 1.25, x: 460 - node.x * 1.25, y: 280 - node.y * 1.25 });
              }}
            />
          ) : null}
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
        <p>点击图中的论文、方法、关键词或作者节点，右侧会显示相关论文、表格行和笔记。</p>
      </div>
    );
  }

  const relatedPapers = props.node.paperIds
    .map((paperId) => props.papers.find((paper) => paper.id === paperId))
    .filter((paper): paper is PaperRecord => Boolean(paper));
  const rowId = props.node.rowIds[0] ?? '';
  const rowIndex = props.workbook.rows.findIndex((row) => row.id === rowId);
  const rowValues = rowIndex > 0 ? getResearchRowValues(props.workbook, rowIndex) : null;
  const noteCount = relatedPapers.filter((paper) => paper.notes.trim()).length;

  return (
    <div className="knowledge-node-detail">
      <div className="node-detail-topline">
        <span className="badge" style={{ background: NODE_STYLE[props.node.type].soft, color: NODE_STYLE[props.node.type].color }}>
          {NODE_TYPE_OPTIONS.find((option) => option.value === props.node?.type)?.label}
        </span>
        <span className="subtle">{props.node.count > 1 ? `出现 ${props.node.count} 次` : '单次出现'}</span>
      </div>
      <h2>{props.node.label}</h2>
      <div className="graph-detail-stats">
        <span>相关论文 <strong>{relatedPapers.length}</strong></span>
        <span>关联笔记 <strong>{noteCount}</strong></span>
        <span>连接 <strong>{props.graph.edges.filter((edge) => edge.source === props.node?.id || edge.target === props.node?.id).length}</strong></span>
      </div>

      {rowValues ? (
        <section>
          <strong>核心信息</strong>
          <div className="row-detail-list">
            {Object.entries(rowValues).map(([key, value]) =>
              value.trim() ? (
                <p key={key}>
                  <span>{key}</span>
                  <em><MarkdownDocument text={value} /></em>
                </p>
              ) : null
            )}
          </div>
        </section>
      ) : null}

      {relatedPapers.length > 0 ? (
        <section>
          <strong>相关论文</strong>
          <div className="related-paper-list">
            {relatedPapers.slice(0, 8).map((paper) => (
              <button key={paper.id} type="button" onClick={() => props.onOpenPaper(paper)}>
                <img className="button-icon" src={pdfReaderIcon} alt="" />
                <span>{paper.chineseTitle || paper.englishTitle || paper.pdfName}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="knowledge-detail-actions">
        <button type="button" className="primary-button button-with-icon" disabled={relatedPapers.length === 0} onClick={() => relatedPapers[0] && props.onOpenPaper(relatedPapers[0])}>
          <img className="button-icon" src={pdfReaderIcon} alt="" />
          <span>打开 PDF</span>
        </button>
        <button type="button" className="secondary-button button-with-icon" disabled={!rowValues} onClick={() => props.onOpenResearchSheet(relatedPapers[0])}>
          <img className="button-icon" src={researchSheetIcon} alt="" />
          <span>查看表格行</span>
        </button>
      </div>
    </div>
  );
}

function GraphContextMenu(props: {
  state: ContextMenuState;
  node: KnowledgeGraphNode | null;
  papers: PaperRecord[];
  onClose: () => void;
  onOpenPaper: (paper: PaperRecord) => void;
  onOpenResearchSheet: (paper?: PaperRecord) => void;
  onHideNode: (nodeId: string) => void;
  onFocusNode: (nodeId: string) => void;
}) {
  if (!props.node) {
    return null;
  }
  const paper = props.node.paperIds[0]
    ? props.papers.find((item) => item.id === props.node?.paperIds[0])
    : undefined;
  return (
    <div className="graph-context-menu" style={{ left: props.state.x, top: props.state.y }}>
      <button type="button" onClick={props.onClose}>查看详情</button>
      <button type="button" disabled={!paper} onClick={() => paper && props.onOpenPaper(paper)}>打开 PDF</button>
      <button type="button" disabled={!paper} onClick={() => props.onOpenResearchSheet(paper)}>查看对应表格行</button>
      <button type="button" onClick={() => props.onFocusNode(props.node!.id)}>固定到画布中心</button>
      <button type="button" className="danger" onClick={() => props.onHideNode(props.node!.id)}>从图谱中临时隐藏</button>
    </div>
  );
}

function filterGraph(
  graph: KnowledgeGraphData,
  selectedTypes: KnowledgeGraphNodeType[],
  searchText: string,
  graphKind: GraphKind,
  maxNodes: number,
  hiddenNodeIds: string[]
): KnowledgeGraphData {
  const allowedTypes = new Set(selectedTypes.length > 0 ? selectedTypes : GRAPH_KIND_TYPES[graphKind]);
  const query = searchText.trim().toLowerCase();
  const hidden = new Set(hiddenNodeIds);
  const nodes = graph.nodes
    .filter((node) => allowedTypes.has(node.type) && !hidden.has(node.id))
    .filter((node) => !query || node.label.toLowerCase().includes(query))
    .slice(0, maxNodes);
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

function layoutNeuronGraph(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[], width: number, height: number): PositionedNode[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const paperNodes = nodes.filter((node) => node.type === 'paper');
  const nonPaperNodes = nodes.filter((node) => node.type !== 'paper');
  const mainPaper = paperNodes[0];
  const positioned: PositionedNode[] = [];

  if (mainPaper) {
    positioned.push({
      ...mainPaper,
      x: centerX,
      y: centerY,
      radius: 26 + Math.min(10, mainPaper.count)
    });
  }

  paperNodes.slice(1).forEach((node, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / Math.max(1, paperNodes.length - 1);
    const radius = Math.min(width, height) * 0.24;
    positioned.push({
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      radius: 18 + Math.min(6, node.count)
    });
  });

  nonPaperNodes.forEach((node, index) => {
    const typeIndex = NODE_TYPE_OPTIONS.findIndex((option) => option.value === node.type);
    const ring = 190 + (typeIndex % 3) * 44;
    const angle = (-Math.PI / 2) + (Math.PI * 2 * (index + typeIndex * 0.4)) / Math.max(1, nonPaperNodes.length);
    const jitter = Math.sin(index * 1.7) * 16;
    positioned.push({
      ...node,
      x: centerX + Math.cos(angle) * (ring + jitter),
      y: centerY + Math.sin(angle) * (ring + jitter),
      radius: node.type === 'method' || node.type === 'keyword' ? 17 + Math.min(8, node.count) : 11 + Math.min(5, node.count)
    });
  });

  return spreadConnectedNodes(positioned, edges);
}

function spreadConnectedNodes(nodes: PositionedNode[], edges: KnowledgeGraphEdge[]): PositionedNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node }]));
  for (const edge of edges.slice(0, 120)) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target || source.type !== 'paper') continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    target.x += (dx / distance) * Math.min(22, edge.weight * 3);
    target.y += (dy / distance) * Math.min(22, edge.weight * 3);
  }
  return [...nodeMap.values()];
}

function getNeighborIds(edges: KnowledgeGraphEdge[], nodeId: string): Set<string> {
  const neighbors = new Set<string>();
  if (!nodeId) return neighbors;
  edges.forEach((edge) => {
    if (edge.source === nodeId) neighbors.add(edge.target);
    if (edge.target === nodeId) neighbors.add(edge.source);
  });
  return neighbors;
}

function buildCurvePath(source: PositionedNode, target: PositionedNode): string {
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const normal = Math.hypot(dx, dy) || 1;
  const curve = Math.min(42, normal * 0.12);
  const controlX = midX - (dy / normal) * curve;
  const controlY = midY + (dx / normal) * curve;
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

function shouldShowLabel(
  node: PositionedNode,
  isSelected: boolean,
  isHovered: boolean,
  isNeighbor: boolean,
  strategy: LabelStrategy
): boolean {
  if (strategy === 'all') return true;
  if (isSelected || isHovered) return true;
  if (strategy === 'hover') return isNeighbor;
  return node.type === 'paper' || (node.count >= 2 && (node.type === 'method' || node.type === 'keyword'));
}

function openNode(
  node: KnowledgeGraphNode,
  papers: PaperRecord[],
  onOpenPaper: (paper: PaperRecord) => void
): void {
  const paper = node.paperIds[0] ? papers.find((item) => item.id === node.paperIds[0]) : undefined;
  if (paper) {
    onOpenPaper(paper);
  }
}

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
}
