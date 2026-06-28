import { describe, expect, it } from 'vitest';
import {
  collapseLocalRepeatedFragments,
  collapseRepeatedTranslationTail,
  extractProtectedAcademicTerms,
  repairAcademicTranslation
} from './academicTranslationQuality';
import { applyAiTranslationResult, type AiProviderSettings, type AiTranslationItem } from './aiTranslation';

describe('academic translation quality repair', () => {
  it('extracts method names, acronyms, and hyphenated academic terms from source text', () => {
    const terms = extractProtectedAcademicTerms(
      'OmniAgent: Native Active Perception for Sim-to-Real Robot Navigation with VLA and CBF-MPC.'
    );

    expect(terms).toContain('OmniAgent');
    expect(terms).toContain('Sim-to-Real');
    expect(terms).toContain('VLA');
    expect(terms).toContain('CBF-MPC');
  });

  it('extracts title-case academic phrases that local translators should not translate', () => {
    const terms = extractProtectedAcademicTerms(
      'HT-Bench: Benchmarking and Learning Dexterous Full-Hand Tactile Representations with Egocentric Vision'
    );

    expect(terms).toContain('HT-Bench');
    expect(terms).toContain('Full-Hand Tactile Representations');
    expect(terms).toContain('Egocentric Vision');
  });

  it('restores a leading proposed method name when a local translator transliterates it', () => {
    const repaired = repairAcademicTranslation(
      'OmniAgent: Native Active Perception as Reasoning for Omni-Modal Understanding',
      '奥姆尼代理：作为全模态理解推理的主动感知',
      { mode: 'title' }
    );

    expect(repaired).toBe('OmniAgent：作为全模态理解推理的主动感知');
  });

  it('does not append visible protected-term notes to abstracts', () => {
    const repaired = repairAcademicTranslation(
      'We introduce DexCap for contact-rich robot manipulation and Sim-to-Real transfer.',
      '我们提出一种用于接触丰富机器人操作和迁移的框架。',
      { mode: 'abstract' }
    );

    expect(repaired).not.toContain('保留术语');
    expect(repaired).not.toContain('术语');
  });

  it('collapses repeated translation tails without rejecting otherwise useful content', () => {
    expect(collapseRepeatedTranslationTail('本文提出一种机器人导航方法。方法方法方法方法')).toBe(
      '本文提出一种机器人导航方法。方法'
    );
    expect(collapseRepeatedTranslationTail('本文有效。本文有效。本文有效。')).toBe('本文有效。');
  });

  it('collapses duplicated trailing Chinese clauses in cached arXiv abstracts', () => {
    const repaired = repairAcademicTranslation(
      'We introduce a tactile teleoperation system for contact-rich manipulation.',
      '我们提出一种用于接触丰富操作的触觉遥操作系统，并通过精确的触觉测量提升操作效率，并通过测量和测量系统进行了更高的测量，并通过测量和测量系统进行了更高的测量。',
      { mode: 'abstract' }
    );

    expect(repaired.match(/并通过测量和测量系统进行了更高的测量/gu)).toHaveLength(1);
    expect(repaired).toContain('触觉遥操作系统');
  });

  it('repairs AI translation results before storing provider metadata', () => {
    const settings: AiProviderSettings = {
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    };
    const item: AiTranslationItem = {
      section: 'Abstract',
      original: 'PILOT: Perceptive Integrated Low-level Controller for robot navigation.',
      translation: '',
      type: 'paragraph'
    };

    const result = applyAiTranslationResult(item, '飞行员：用于机器人导航的感知集成低层控制器控制器控制器控制器', settings);

    expect(result.translation).toContain('PILOT');
    expect(result.translation.endsWith('控制器控制器控制器控制器')).toBe(false);
    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-chat');
  });

  it('repairs arXiv title translations that damage method names and key English terms', () => {
    const repaired = repairAcademicTranslation(
      'TaCauchy: An Extensible FEM Framework for Vision-Based Tactile Simulation',
      '塔科奇: 基于视觉的触觉模拟的可扩展FEM框架',
      { mode: 'title' }
    );

    expect(repaired).toContain('TaCauchy');
    expect(repaired).toContain('FEM');
    expect(repaired).toContain('Vision-Based');
    expect(repaired).not.toContain('塔科奇');
    expect(repaired).not.toContain('术语');
  });

  it('keeps important title phrases visible when the local translator partially translates them', () => {
    const repaired = repairAcademicTranslation(
      'HT-Bench: Benchmarking and Learning Dexterous Full-Hand Tactile Representations with Egocentric Vision',
      'HT-Bench: 以以Egocentral Visia为视角的基准和学习 Dexterous Full-Hand Tactile 代表',
      { mode: 'title' }
    );

    expect(repaired).toContain('HT-Bench');
    expect(repaired).toContain('Egocentric Vision');
    expect(repaired).not.toContain('以以');
    expect(repaired).not.toContain('Egocentral Visia');
    expect(repaired).not.toContain('术语');
  });

  it('strips stale visible term annotations from cached translation text', () => {
    const repaired = repairAcademicTranslation(
      'Do as I Do: Dexterous Manipulation Data from Everyday Human Videos',
      '像我这样做: 从日常人类视频中获取机器人操作数据（保留术语：human-like；multi-fingered）',
      { mode: 'abstract' }
    );

    expect(repaired).not.toContain('保留术语');
    expect(repaired).not.toContain('human-like');
    expect(repaired).not.toContain('multi-fingered');
  });

  it('collapses repeated local fragments in the middle of low-quality translations', () => {
    expect(collapseLocalRepeatedFragments('以以Egocentric Vision 为为视角，方法方法有效。')).toBe(
      '以Egocentric Vision 为视角，方法有效。'
    );
  });
});
