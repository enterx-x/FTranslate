import { describe, expect, it } from 'vitest';
import {
  buildCachedVisionBlocks,
  buildVisionOcrBlocks,
  calculateVisionRenderScale,
  parseVisionOcrResponse
} from './mobileVisionOcr';

describe('mobile scanned PDF vision OCR', () => {
  it('parses fenced bilingual paragraph JSON and normalizes unknown block types', () => {
    expect(parseVisionOcrResponse(`\`\`\`json
      {"paragraphs":[
        {"type":"heading","original":"Safe RL","translation":"安全强化学习"},
        {"type":"unknown","original":"The policy is safe.","translationZh":"该策略是安全的。"}
      ]}
    \`\`\``)).toEqual([
      { type: 'heading', original: 'Safe RL', translation: '安全强化学习' },
      { type: 'paragraph', original: 'The policy is safe.', translation: '该策略是安全的。' }
    ]);
  });

  it('rejects a plain-text response from a model without structured image output', () => {
    expect(() => parseVisionOcrResponse('I cannot inspect images.')).toThrow('不支持图片输入');
  });

  it('accepts a top-level paragraph array from compatible providers', () => {
    expect(parseVisionOcrResponse('[{"original":"Abstract","translation":"摘要","type":"heading"}]'))
      .toEqual([{ original: 'Abstract', translation: '摘要', type: 'heading' }]);
  });

  it('builds stable ordered blocks and restores them from cached translations', () => {
    const blocks = buildVisionOcrBlocks(2, [
      { type: 'heading', original: 'Methods', translation: '方法' },
      { type: 'paragraph', original: 'We train the policy.', translation: '我们训练该策略。' }
    ]);
    expect(blocks.map((item) => item.order)).toEqual([1000, 1001]);
    expect(blocks[0].block.page).toBe(2);
    expect(blocks[0].block.sourceHash).not.toBe(blocks[1].block.sourceHash);

    const restored = buildCachedVisionBlocks(blocks.slice().reverse().map((item) => ({
      sourceHash: item.block.sourceHash,
      page: item.block.page,
      original: item.block.original,
      translation: item.translation,
      translatedAt: '2026-07-15T00:00:00.000Z',
      model: 'vision-model',
      origin: 'vision' as const,
      order: item.order,
      blockType: item.block.type
    })));
    expect(restored.map((block) => block.original)).toEqual(['Methods', 'We train the policy.']);
    expect(restored[0].type).toBe('heading');
  });

  it('caps scanned-page rendering for mobile memory use', () => {
    expect(calculateVisionRenderScale(595, 842)).toBeCloseTo(1.9, 1);
    expect(calculateVisionRenderScale(2000, 1000)).toBe(0.8);
    expect(calculateVisionRenderScale(400, 400)).toBe(2);
  });
});
