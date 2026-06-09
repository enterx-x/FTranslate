import { describe, expect, it } from 'vitest';
import type { ArxivPaper } from './arxivClient';
import { buildArxivBibTeX, buildArxivExportMarkdown, buildArxivPaperInsight } from './arxivUi';

const robotPaper: ArxivPaper = {
  id: 'http://arxiv.org/abs/2601.17440v1',
  stableId: '2601.17440',
  title: 'PILOT: A Perceptive Integrated Low-level Controller for Loco-manipulation',
  authors: ['Xinru Cui', 'Hesheng Wang'],
  summary:
    'Humanoid robots require reinforcement learning, perception, path planning, safe control, real-world experiments and loco-manipulation over unstructured scenes.',
  published: '2026-01-24T00:00:00Z',
  publishedAt: '2026-01-24T00:00:00Z',
  updated: '2026-01-24T00:00:00Z',
  categories: ['cs.RO', 'cs.AI'],
  primaryCategory: 'cs.RO',
  abstractUrl: 'http://arxiv.org/abs/2601.17440v1',
  pdfUrl: 'https://arxiv.org/pdf/2601.17440v1.pdf'
};

describe('arxivUi helpers', () => {
  it('builds explainable scores from paper metadata without calling arXiv or AI', () => {
    const insight = buildArxivPaperInsight(robotPaper, 'reinforcement learning robot navigation');

    expect(insight.readingPriority).toBe('high');
    expect(insight.totalScore).toBeGreaterThanOrEqual(70);
    expect(insight.topicMatch.rl).toBeGreaterThanOrEqual(7);
    expect(insight.topicMatch.robotics).toBeGreaterThanOrEqual(7);
    expect(insight.topicMatch.path_planning).toBeGreaterThanOrEqual(5);
    expect(insight.tags).toEqual(expect.arrayContaining(['RL', '机器人', '路径规划']));
    expect(insight.reasonZh).toContain('RL');
  });

  it('exports a selected arXiv paper as readable Markdown with optional Chinese abstract', () => {
    const markdown = buildArxivExportMarkdown(robotPaper, {
      abstractZh: '类人机器人需要感知、强化学习和安全控制。',
      insight: buildArxivPaperInsight(robotPaper, 'robot navigation')
    });

    expect(markdown).toContain('# PILOT');
    expect(markdown).toContain('## 中文摘要');
    expect(markdown).toContain('类人机器人需要感知');
    expect(markdown).toContain('https://arxiv.org/pdf/2601.17440v1.pdf');
  });

  it('exports BibTeX using the stable arXiv id and first author year', () => {
    const bibtex = buildArxivBibTeX(robotPaper);

    expect(bibtex).toContain('@misc{cui2026pilot');
    expect(bibtex).toContain('eprint={2601.17440}');
    expect(bibtex).toContain('archivePrefix={arXiv}');
  });
});
