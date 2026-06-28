import { describe, expect, it } from 'vitest';
import { clampReaderSidePanelRatio, shouldResetReaderSidePanelRatio } from './useReaderSidePanel';

describe('shouldResetReaderSidePanelRatio', () => {
  it('resets only for two close pointer taps without dragging', () => {
    expect(shouldResetReaderSidePanelRatio(1000, 1240, false)).toBe(true);
    expect(shouldResetReaderSidePanelRatio(1000, 1400, false)).toBe(false);
    expect(shouldResetReaderSidePanelRatio(1000, 1100, true)).toBe(false);
  });
});

describe('clampReaderSidePanelRatio', () => {
  it('allows a narrow reader side panel while keeping it usable', () => {
    expect(clampReaderSidePanelRatio(0.18)).toBe(0.2);
    expect(clampReaderSidePanelRatio(0.32)).toBe(0.32);
    expect(clampReaderSidePanelRatio(0.5)).toBe(0.46);
  });
});
