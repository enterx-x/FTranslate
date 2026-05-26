import { describe, expect, it } from 'vitest';
import { buildCurrentJsonPrompt, buildFullJsonPrompt } from './promptTemplates';
import type { TranslationItem } from './translation';

describe('prompt template helpers', () => {
  const item: TranslationItem = {
    section: 'Abstract',
    original: 'Foundation models emerge from large and diverse datasets.',
    translation: ''
  };

  it('builds a current paragraph JSON prompt with schema constraints', () => {
    const prompt = buildCurrentJsonPrompt(item);

    expect(prompt).toContain('section、original、translation');
    expect(prompt).toContain('"section": "Abstract"');
    expect(prompt).toContain('Foundation models emerge');
    expect(prompt).toContain('不要使用 Markdown');
  });

  it('builds a full-document JSON prompt from multiple paragraphs', () => {
    const prompt = buildFullJsonPrompt([
      item,
      {
        section: 'I. INTRODUCTION',
        original: 'Robots need robust generalization.',
        translation: ''
      }
    ]);

    expect(prompt).toContain('"section": "I. INTRODUCTION"');
    expect(prompt).toContain('Robots need robust generalization.');
    expect(prompt).toContain('JSON 数组');
  });

  it('explains what to paste when no extracted English paragraph is available', () => {
    const prompt = buildFullJsonPrompt([]);

    expect(prompt).toContain('请先把英文原文段落粘贴到这里');
  });
});
