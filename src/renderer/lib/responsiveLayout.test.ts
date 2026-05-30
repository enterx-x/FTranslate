import { describe, expect, it } from 'vitest';
import { clampPanelRatio, getPanelRatioFromPointer } from './responsiveLayout';

describe('responsive layout helpers', () => {
  it('clamps panel ratios to a safe range', () => {
    expect(clampPanelRatio(0.2)).toBe(0.42);
    expect(clampPanelRatio(0.9)).toBe(0.8);
    expect(clampPanelRatio(0.64)).toBe(0.64);
  });

  it('falls back to a stable ratio when the container width is invalid', () => {
    expect(getPanelRatioFromPointer({ clientX: 300, left: 0, width: 0 })).toBe(0.68);
  });

  it('derives a clamped ratio from pointer position inside a container', () => {
    expect(getPanelRatioFromPointer({ clientX: 760, left: 40, width: 1000 })).toBe(0.72);
    expect(getPanelRatioFromPointer({ clientX: 1200, left: 40, width: 1000 })).toBe(0.8);
  });
});
