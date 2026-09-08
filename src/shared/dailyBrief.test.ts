import { describe, expect, it } from 'vitest';
import {
  DAILY_BRIEF_DEFAULT_PREFERENCES,
  DAILY_BRIEF_MAX_PAPERS,
  isDailyBriefTime,
  normalizeDailyBriefPreferences
} from './dailyBrief';

describe('daily brief shared contracts', () => {
  it('keeps the default schedule disabled and clamps unsafe preferences', () => {
    expect(DAILY_BRIEF_DEFAULT_PREFERENCES.enabled).toBe(false);
    expect(DAILY_BRIEF_MAX_PAPERS).toBeGreaterThan(0);
    expect(normalizeDailyBriefPreferences({
      enabled: true,
      time: '9:99',
      interests: ' robotics ',
      excludeTerms: ' spam ',
      maxPapers: 999,
      useAi: true
    })).toEqual({
      enabled: true,
      time: DAILY_BRIEF_DEFAULT_PREFERENCES.time,
      interests: 'robotics',
      excludeTerms: 'spam',
      maxPapers: DAILY_BRIEF_MAX_PAPERS,
      useAi: true
    });
  });

  it('accepts only local clock values in the HH:mm contract', () => {
    expect(isDailyBriefTime('00:00')).toBe(true);
    expect(isDailyBriefTime('23:59')).toBe(true);
    expect(isDailyBriefTime('24:00')).toBe(false);
    expect(isDailyBriefTime('9:30')).toBe(false);
    expect(isDailyBriefTime('09:60')).toBe(false);
  });
});
