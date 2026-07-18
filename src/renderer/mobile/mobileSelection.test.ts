import { describe, expect, it } from 'vitest';
import {
  calculateMobileSelectionPopoverPosition,
  isEnglishAcademicSelection,
  normalizeMobileSelectionText
} from './mobileSelection';

describe('mobile selection translation', () => {
  it('normalizes an actual short selection and rejects empty or oversized text', () => {
    expect(normalizeMobileSelectionText('  control\n barrier   function  ')).toBe('control barrier function');
    expect(normalizeMobileSelectionText('   ')).toBe('');
    expect(normalizeMobileSelectionText('a'.repeat(801))).toBe('');
  });

  it('only offers the paper selection translator for text containing English', () => {
    expect(isEnglishAcademicSelection('Control Barrier Function')).toBe(true);
    expect(isEnglishAcademicSelection('Eq. (3) 中的 h(x)')).toBe(true);
    expect(isEnglishAcademicSelection('控制障碍函数')).toBe(false);
  });

  it('keeps the popover inside the visual viewport above a bottom selection', () => {
    expect(calculateMobileSelectionPopoverPosition({
      left: 330,
      right: 388,
      top: 760,
      bottom: 792,
      width: 58
    }, {
      width: 390,
      height: 844,
      offsetLeft: 0,
      offsetTop: 0
    })).toEqual({
      left: 98,
      top: 584,
      width: 280,
      maxHeight: 248
    });
  });

  it('respects visual viewport offsets after Safari zoom or browser chrome changes', () => {
    const position = calculateMobileSelectionPopoverPosition({
      left: 96,
      right: 166,
      top: 240,
      bottom: 270,
      width: 70
    }, {
      width: 320,
      height: 600,
      offsetLeft: 40,
      offsetTop: 80
    });
    expect(position.left).toBeGreaterThanOrEqual(52);
    expect(position.left + position.width).toBeLessThanOrEqual(348);
    expect(position.top).toBeGreaterThanOrEqual(92);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(668);
  });
});
