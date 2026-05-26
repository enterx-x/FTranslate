import { describe, expect, it } from 'vitest';
import {
  findBestTextItemMatch,
  findTextItemMatches,
  normalizePdfSearchText
} from './pdfTextHighlight';

describe('PDF text highlight matching', () => {
  it('normalizes whitespace, casing, punctuation, and line-break hyphenation', () => {
    expect(normalizePdfSearchText('Zero-\nshot  Cross-Embodiment π0.7')).toBe(
      'zeroshot crossembodiment π0 7'
    );
  });

  it('matches query text across multiple PDF text items', () => {
    const matches = findTextItemMatches(
      [
        { str: 'Foundation models work on' },
        { str: ' the principle that generalist' },
        { str: ' capabilities emerge from training.' }
      ],
      'models work on the principle that generalist capabilities'
    );

    expect(matches).toEqual([0, 1, 2]);
  });

  it('matches words split by PDF line-break hyphenation', () => {
    const matches = findTextItemMatches(
      [{ str: 'zero-' }, { str: 'shot cross-' }, { str: 'embodiment generalization' }],
      'zero-shot cross-embodiment'
    );

    expect(matches).toEqual([0, 1, 2]);
  });

  it('returns no matches when query text is not present', () => {
    const matches = findTextItemMatches(
      [{ str: 'The paper studies robot policies.' }],
      'language model scaling law'
    );

    expect(matches).toEqual([]);
  });

  it('falls back to a sentence-level partial match when enough sentences are present', () => {
    const result = findBestTextItemMatch(
      [
        { str: 'Foundation models work on the principle that generalist capabilities' },
        { str: ' emerge from training on large and diverse datasets.' },
        { str: ' Large language models can recall facts and compose semantic knowledge.' },
        { str: ' Unrelated text in the same PDF column.' }
      ],
      [
        'Foundation models work on the principle that generalist capabilities',
        'emerge from training on large and diverse datasets.',
        'Large language models can recall facts and compose semantic knowledge.',
        'This short tail is missing.'
      ].join(' ')
    );

    expect(result.strategy).toBe('sentence');
    expect(result.itemIndexes).toEqual([0, 1, 2]);
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it('rejects a single low-coverage sentence fallback for a long paragraph', () => {
    const result = findBestTextItemMatch(
      [
        { str: 'Foundation models work on the principle that generalist capabilities' },
        { str: ' emerge from training on large and diverse datasets.' }
      ],
      [
        'Foundation models work on the principle that generalist capabilities',
        'emerge from training on large and diverse datasets.',
        'For example, large language models can recall facts and semantic knowledge.',
        'This kind of compositional generalization remains challenging in physical intelligence.'
      ].join(' ')
    );

    expect(result.strategy).toBe('none');
    expect(result.itemIndexes).toEqual([]);
  });

  it('uses token-overlap fuzzy matching when punctuation and several words differ', () => {
    const result = findBestTextItemMatch(
      [
        { str: 'Foundation models work on the principle that generalist capabilities emerge' },
        { str: ' from training on large diverse datasets and semantic knowledge.' },
        { str: ' Robot foundation models are discussed later.' }
      ],
      'Foundation models work on a principle where generalist capabilities emerge from training on large and diverse datasets.'
    );

    expect(result.strategy).toBe('fuzzy');
    expect(result.itemIndexes).toEqual([0, 1]);
    expect(result.score).toBeGreaterThanOrEqual(0.75);
  });

  it('rejects partial fuzzy matches below the display threshold for long paragraphs', () => {
    const result = findBestTextItemMatch(
      [
        { str: 'Foundation models work on the principle that generalist capabilities emerge' },
        { str: 'from training on large and diverse datasets in a robotics paper' }
      ],
      [
        'Foundation models work on the principle that generalist capabilities emerge',
        'from training on large and diverse datasets.',
        'For example, large language models can recall facts and compose semantic knowledge.',
        'This kind of compositional generalization remains challenging in physical intelligence.'
      ].join(' ')
    );

    expect(result.strategy).toBe('none');
    expect(result.itemIndexes).toEqual([]);
  });

  it('reports no useful match when token overlap is too low', () => {
    const result = findBestTextItemMatch(
      [{ str: 'The paper studies robot policies and manipulation.' }],
      'language model scaling law and dataset curation'
    );

    expect(result.strategy).toBe('none');
    expect(result.itemIndexes).toEqual([]);
  });

  it('rejects weak fuzzy matches that only share figure-label vocabulary', () => {
    const result = findBestTextItemMatch(
      [
        { str: 'Robot Data Demonstration Data Non-Robot Data Multimodal Web Data' },
        { str: 'Language Instructions Subgoal Images Episode Metadata' },
        { str: 'Fig. 1: We introduce π0.7, a steerable generalist robot foundation model.' }
      ],
      [
        'We present a new robotic foundation model, called π0.7, that can enable strong',
        'out-of-the-box performance in a wide range of scenarios. The main idea behind',
        'π0.7 is to use diverse context conditioning during training.'
      ].join(' ')
    );

    expect(result.strategy).toBe('none');
    expect(result.itemIndexes).toEqual([]);
  });
});
