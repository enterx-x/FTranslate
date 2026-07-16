import { describe, expect, it } from 'vitest';
import {
  buildArxivApiUrl,
  buildArxivCacheKey,
  isMojibakeTranslationText,
  normalizeArxivSearchQuery,
  type ArxivQueryMode,
  type ArxivSearchRequest
} from './arxiv';

function getSearchExpression(searchQuery: string, queryMode?: ArxivQueryMode): string {
  const request: ArxivSearchRequest = {
    searchQuery,
    queryMode,
    category: '',
    start: 0,
    maxResults: 50,
    sortBy: 'comprehensive',
    sortOrder: 'descending'
  };
  return new URL(buildArxivApiUrl(request)).searchParams.get('search_query') ?? '';
}

describe('arXiv query builder', () => {
  it('uses balanced mode by default while strict and explore build distinct expressions', () => {
    const defaultExpression = getSearchExpression('robot navigation');
    const balancedExpression = getSearchExpression('robot navigation', 'balanced');
    const strictExpression = getSearchExpression('robot navigation', 'strict');
    const exploreExpression = getSearchExpression('robot navigation', 'explore');

    expect(defaultExpression).toBe(balancedExpression);
    expect(strictExpression).toContain('ti:"robot navigation"');
    expect(strictExpression).not.toContain('robotic navigation');
    expect(balancedExpression).toContain('robotic navigation');
    expect(exploreExpression).toContain('autonomous navigation');
    expect(new Set([strictExpression, balancedExpression, exploreExpression]).size).toBe(3);
  });

  it('keeps query-mode cache entries isolated even when the visible query is identical', () => {
    const request: ArxivSearchRequest = {
      searchQuery: '机器人导航',
      category: 'cs.RO',
      start: 0,
      maxResults: 50,
      sortBy: 'comprehensive',
      sortOrder: 'descending'
    };

    const strictKey = buildArxivCacheKey({ ...request, queryMode: 'strict' });
    const balancedKey = buildArxivCacheKey({ ...request, queryMode: 'balanced' });
    const exploreKey = buildArxivCacheKey({ ...request, queryMode: 'explore' });

    expect(new Set([strictKey, balancedKey, exploreKey]).size).toBe(3);
    expect(normalizeArxivSearchQuery('机器人导航', 'strict')).not.toBe(
      normalizeArxivSearchQuery('机器人导航', 'explore')
    );
  });
  it('does not mix search history or fixed latent robot keywords into a single Chinese tactile search', () => {
    const expression = getSearchExpression('触觉');

    expect(expression).toContain('ti:tactile');
    expect(expression).toContain('abs:haptic');
    expect(expression).not.toContain('ti:robot');
    expect(expression).not.toContain('abs:robot');
    expect(expression).not.toContain('robot navigation');
    expect(expression).not.toContain('reinforcement learning');
    expect(expression).not.toContain('contact-rich manipulation');
    expect(expression).not.toContain('ti:manipulation');
  });

  it('requires every requested concept in balanced mode while explore mode keeps broad recall', () => {
    const balancedExpression = getSearchExpression('tactile robot navigation', 'balanced');
    const exploreExpression = getSearchExpression('tactile robot navigation', 'explore');

    expect(balancedExpression).toContain('ti:tactile');
    expect(balancedExpression).toContain('ti:"robot navigation"');
    expect(balancedExpression).toMatch(/\) AND \(/u);
    expect(exploreExpression).toContain('ti:tactile');
    expect(exploreExpression).toContain('ti:"robot navigation"');
    expect(exploreExpression).toMatch(/\) OR \(/u);
  });

  it('treats Chinese humanoid tactile search as two required research concepts', () => {
    const normalized = normalizeArxivSearchQuery('人形触觉');
    const expression = getSearchExpression('人形触觉', 'balanced');

    expect(normalized).toContain('humanoid');
    expect(normalized).toContain('tactile');
    expect(expression).toContain('ti:humanoid');
    expect(expression).toContain('ti:tactile');
    expect(expression).toMatch(/\) AND \(/u);
    expect(expression).not.toContain('doll');
  });

  it('expands Chinese tactile searches into English tactile and haptic terms', () => {
    const normalized = normalizeArxivSearchQuery('触觉');

    expect(normalized.toLowerCase()).toContain('tactile');
    expect(normalized.toLowerCase()).toContain('haptic');
    expect(normalized.toLowerCase()).not.toContain('contact-rich manipulation');
  });

  it('expands short Chinese machine and robot terms instead of sending them to arXiv as Chinese text', () => {
    const machineExpression = getSearchExpression('机器');
    const mlExpression = getSearchExpression('机器学习');

    expect(normalizeArxivSearchQuery('机器').toLowerCase()).toContain('machine');
    expect(machineExpression).not.toContain('机器');
    expect(machineExpression).toContain('ti:machine');
    expect(machineExpression).toContain('abs:robot');
    expect(mlExpression).not.toContain('机器学习');
    expect(mlExpression).toContain('machine learning');
  });

  it('covers common Chinese academic search terms across robotics, AI, control, and science', () => {
    const expression = getSearchExpression('柔顺操作 多指抓取 轨迹优化 深度学习 图神经网络 扩散模型 材料 量子');

    expect(expression).not.toContain('柔顺操作');
    expect(expression).toContain('compliant manipulation');
    expect(expression).toContain('dexterous grasping');
    expect(expression).toContain('trajectory optimization');
    expect(expression).toContain('deep learning');
    expect(expression).toContain('graph neural network');
    expect(expression).toContain('diffusion model');
    expect(expression).toContain('materials');
    expect(expression).toContain('quantum');
  });

  it('expands broad non-robotics Chinese terms for a general arXiv search tool', () => {
    const expression = getSearchExpression('统计学习 数据库 网络安全 医学影像 信息检索 计算机图形学');

    expect(expression).not.toContain('统计学习');
    expect(expression).not.toContain('医学影像');
    expect(expression).toContain('statistical learning');
    expect(expression).toContain('database');
    expect(expression).toContain('cybersecurity');
    expect(expression).toContain('medical imaging');
    expect(expression).toContain('information retrieval');
    expect(expression).toContain('computer graphics');
  });

  it('keeps balanced tactile searches compact without standalone sensing or perception clauses', () => {
    const expression = getSearchExpression('触觉');

    expect(expression).toContain('ti:tactile');
    expect(expression).toContain('ti:haptic');
    expect(expression).toContain('ti:visuotactile');
    expect(expression).not.toContain('ti:sensing');
    expect(expression).not.toContain('abs:sensing');
    expect(expression).not.toContain('ti:perception');
    expect(expression).not.toContain('abs:perception');
  });

  it('expands broad embodied and planning searches without locking to one domain', () => {
    const expression = getSearchExpression('具身智能 路径规划 MPC CBF');

    expect(expression).toContain('embodied');
    expect(expression).toContain('path planning');
    expect(expression).toContain('model predictive control');
    expect(expression).toContain('control barrier function');
    expect(expression).not.toContain('tactile');
  });

  it('supports latest-all searches without turning the wildcard into a literal word', () => {
    const expression = getSearchExpression('*');

    expect(expression).toBe('all:*');
    expect(expression).not.toContain('ti:*');
    expect(expression).not.toContain('abs:*');
  });

  it('does not treat acronym fragments inside ordinary words as research concepts', () => {
    const worldModelExpression = getSearchExpression('world model');
    const compCertExpression = getSearchExpression('CompCert verification', 'explore');

    expect(worldModelExpression).toContain('world model');
    expect(worldModelExpression).not.toContain('reinforcement learning');
    expect(worldModelExpression).not.toMatch(/(?:ti|abs):rl\b/u);
    expect(compCertExpression).not.toContain('model predictive control');
    expect(compCertExpression).not.toContain('receding horizon control');
    expect(compCertExpression).not.toMatch(/(?:ti|abs):mpc\b/u);
    expect(compCertExpression).not.toMatch(/(?:ti|abs):(receding|horizon)\b/u);
  });

  it('normalizes reversed year bounds for both requests and cache identity', () => {
    const baseRequest: ArxivSearchRequest = {
      searchQuery: 'robot navigation',
      category: '',
      start: 0,
      maxResults: 50,
      sortBy: 'relevance',
      sortOrder: 'descending'
    };
    const reversedRequest = { ...baseRequest, yearFrom: '2026', yearTo: '2024' };
    const orderedRequest = { ...baseRequest, yearFrom: '2024', yearTo: '2026' };
    const expression = new URL(buildArxivApiUrl(reversedRequest)).searchParams.get('search_query') ?? '';

    expect(expression).toContain('submittedDate:[202401010000 TO 202612312359]');
    expect(buildArxivCacheKey(reversedRequest)).toBe(buildArxivCacheKey(orderedRequest));
  });

  it('treats repeated local translation artifacts as unusable text', () => {
    expect(isMojibakeTranslationText('互出强化代理互出')).toBe(true);
    expect(isMojibakeTranslationText('分析分析分析分析分析')).toBe(true);
  });
});
