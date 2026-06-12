import { describe, expect, it } from 'vitest';
import type { ArxivPaper } from './arxivClient';
import {
  buildArxivBibTeX,
  buildArxivExportMarkdown,
  buildArxivPaperInsight,
  formatArxivResultRange,
  parseArxivTitleAbstractTranslation
} from './arxivUi';

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

  it('exports Chinese title while preserving English title with Chinese abstract', () => {
    const markdown = buildArxivExportMarkdown(robotPaper, {
      titleZh: 'PILOT：用于运动操作的感知集成底层控制器',
      abstractZh: '该论文研究类人机器人在复杂场景中的运动操作控制。',
      insight: buildArxivPaperInsight(robotPaper, 'robot navigation')
    });

    expect(markdown).toContain('# PILOT：用于运动操作的感知集成底层控制器');
    expect(markdown).toContain(`- English title: ${robotPaper.title}`);
    expect(markdown).toContain('## 中文摘要');
    expect(markdown).toContain('该论文研究类人机器人在复杂场景中的运动操作控制。');
  });

  it('exports BibTeX using the stable arXiv id and first author year', () => {
    const bibtex = buildArxivBibTeX(robotPaper);

    expect(bibtex).toContain('@misc{cui2026pilot');
    expect(bibtex).toContain('eprint={2601.17440}');
    expect(bibtex).toContain('archivePrefix={arXiv}');
  });

  it('parses strict JSON title and abstract translations', () => {
    const parsed = parseArxivTitleAbstractTranslation(
      JSON.stringify({
        titleZh: 'PILOT：感知集成底层控制器',
        abstractZh: '类人机器人需要在非结构化场景中进行移动操作。'
      }),
      robotPaper
    );

    expect(parsed).toEqual({
      titleZh: 'PILOT：感知集成底层控制器',
      abstractZh: '类人机器人需要在非结构化场景中进行移动操作。'
    });
  });

  it('parses fenced JSON translation output from AI providers', () => {
    const parsed = parseArxivTitleAbstractTranslation(
      '```json\n{"titleZh":"中文标题","abstractZh":"中文摘要"}\n```',
      robotPaper
    );

    expect(parsed.titleZh).toBe('中文标题');
    expect(parsed.abstractZh).toBe('中文摘要');
  });

  it('falls back to translated plain text when AI output is not JSON', () => {
    const parsed = parseArxivTitleAbstractTranslation('这是一段中文摘要。', robotPaper);

    expect(parsed.titleZh).toBe('');
    expect(parsed.abstractZh).toBe('这是一段中文摘要。');
  });

  it('formats arXiv result ranges with total counts', () => {
    expect(formatArxivResultRange(0, 50, 3456)).toBe('1-50 / 3456 篇');
    expect(formatArxivResultRange(50, 50, 3456)).toBe('51-100 / 3456 篇');
    expect(formatArxivResultRange(0, 0, 3456)).toBe('0 / 3456 篇');
  });
});
