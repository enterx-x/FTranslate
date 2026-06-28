import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS_CATEGORY } from './SettingsPage';

describe('SettingsPage defaults', () => {
  it('opens the general category first', () => {
    expect(DEFAULT_SETTINGS_CATEGORY).toBe('general');
  });
});
