import { useMemo } from 'react';
import { APP_SETTINGS_KEY, parseAppSettings, type AppSettings } from '../lib/appSettings';

export function readAppSettings(rawValue: string | null): AppSettings {
  return parseAppSettings(rawValue);
}

export function useAppSettings(refreshKey: unknown): AppSettings {
  return useMemo(
    () => readAppSettings(localStorage.getItem(APP_SETTINGS_KEY)),
    [refreshKey]
  );
}
