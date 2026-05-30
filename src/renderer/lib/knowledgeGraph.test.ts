import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraph, downloadKnowledgeGraphJson, type KnowledgeGraphData } from './knowledgeGraph';
import type { PaperRecord } from './papers';
import {
  buildDefaultResearchWorkbook,
  setResearchCellText,
  type ResearchWorkbook
} from './researchWorkbook';

function paper(partial: Partial<PaperRecord>): PaperRecord {
  return {
    id: partial.id ?? 'paper-1',
    pdfPath: partial.pdfPath ?? 'a.pdf',
    pdfName: partial.pdfName ?? 'a.pdf',
    translationPath: '',
    translationName: '',
    chineseTitle: partial.chineseTitle ?? '',
    englishTitle: partial.englishTitle ?? '',
    journal: partial.journal ?? '',
    authors: partial.authors ?? '',
    year: partial.year ?? '',
    notes: partial.notes ?? '',
    lastOpenedAt: new Date(0).toISOString(),
    lastPage: 1
  };
}

function workbookWithRows(): ResearchWorkbook {
  let workbook = buildDefaultResearchWorkbook();
  workbook = {
    ...workbook,
    rows: [
      workbook.rows[0],
      {
        id: 'row-1',
        cells: workbook.columns.map(() => ({ value: '' }))
      },
      {
        id: 'row-2',
        cells: workbook.columns.map(() => ({ value: '' }))
      }
    ]
  };
  workbook = setResearchCellText(workbook, 1, 0, 'paper-a.pdf');
  workbook = setResearchCellText(workbook, 1, 1, '安全强化学习路径规划');
  workbook = setResearchCellText(workbook, 1, 3, 'PPO + CBF 安全约束');
  workbook = setResearchCellText(workbook, 1, 5, 'PPO, CBF, MPC');
  workbook = setResearchCellText(workbook, 1, 6, '移动机器人、路径规划');
  workbook = setResearchCellText(workbook, 1, 7, 'success rate, collision rate');
  workbook = setResearchCellText(workbook, 2, 0, 'paper-b.pdf');
  workbook = setResearchCellText(workbook, 2, 1, 'PINN 机器人导航');
  workbook = setResearchCellText(workbook, 2, 5, 'PINN, MPC');
  workbook = setResearchCellText(workbook, 2, 6, '路径规划');
  return workbook;
}

describe('buildKnowledgeGraph', () => {
  it('extracts paper, method, scene, metric and linked metadata nodes from the research workbook', () => {
    const graph = buildKnowledgeGraph({
      workbook: workbookWithRows(),
      papers: [
        paper({
          id: 'paper-a',
          pdfPath: 'paper-a.pdf',
          pdfName: 'paper-a.pdf',
          authors: 'Author A, Author B',
          year: '2026',
          journal: 'ICRA'
        })
      ],
      links: [{ rowId: 'row-1', paperId: 'paper-a' }]
    });

    expect(graph.stats.paperCount).toBe(2);
    expect(graph.nodes.some((node) => node.type === 'paper' && node.label.includes('安全强化学习'))).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'method' && node.label === 'CBF')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'method' && node.label === 'PINN')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'scene' && node.label === '路径规划')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'metric' && node.label === 'collision rate')).toBe(true);
    expect(graph.edges.some((edge) => edge.label === '方法')).toBe(true);
  });

  it('can build a library-only graph from paper metadata and notes', () => {
    const graph = buildKnowledgeGraph({
      source: 'library',
      workbook: buildDefaultResearchWorkbook(),
      papers: [
        paper({
          id: 'paper-c',
          chineseTitle: '控制屏障函数导航',
          englishTitle: 'Safe Navigation with CBF',
          authors: 'Author C',
          year: '2025',
          journal: 'T-RO',
          notes: 'PPO, CBF, safety constraint'
        })
      ],
      links: []
    });

    expect(graph.stats.paperCount).toBe(1);
    expect(graph.nodes.some((node) => node.type === 'author' && node.label === 'Author C')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'method' && node.label === 'CBF')).toBe(true);
  });

  it('downloads knowledge graph JSON instead of only copying it to the clipboard', async () => {
    let clicked = 0;
    let revokedUrl = '';
    let capturedBlob: { size: number; type: string } | null = null;
    const link = {
      href: '',
      download: '',
      click: () => {
        clicked += 1;
      }
    };
    class FakeBlob {
      size: number;
      type: string;

      constructor(parts: unknown[], options?: { type?: string }) {
        this.size = String(parts[0] ?? '').length;
        this.type = options?.type ?? '';
      }
    }
    const graph: KnowledgeGraphData = {
      nodes: [{ id: 'paper:1', type: 'paper', label: 'Paper 1', count: 1, paperIds: ['paper-1'], rowIds: [] }],
      edges: [],
      stats: {
        paperCount: 1,
        nodeCount: 1,
        edgeCount: 0,
        topKeywords: [],
        topMethods: []
      }
    };

    const json = downloadKnowledgeGraphJson(graph, {
      BlobCtor: FakeBlob as unknown as typeof Blob,
      createDownloadLink: () => link,
      createObjectUrl: (blob) => {
        capturedBlob = blob as unknown as { size: number; type: string };
        return 'blob:knowledge-graph';
      },
      revokeObjectUrl: (url) => {
        revokedUrl = url;
      }
    });

    expect(json).toContain('"label": "Paper 1"');
    expect(link.href).toBe('blob:knowledge-graph');
    expect(link.download).toBe('ftranslate-knowledge-graph.json');
    expect(clicked).toBe(1);
    expect(revokedUrl).toBe('blob:knowledge-graph');
    expect(capturedBlob).not.toBeNull();
    const blob: { size: number; type: string } = capturedBlob ?? { size: 0, type: '' };
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/json;charset=utf-8');
  });
});
