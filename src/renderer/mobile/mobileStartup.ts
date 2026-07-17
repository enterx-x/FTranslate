import {
  mergeHydratedMobileLibrary,
  type MobilePaper,
  type MobileTranslationSession
} from './mobileTypes';

export function resolveMobileStartupState(input: {
  libraryResult: PromiseSettledResult<MobilePaper[]>;
  preferencesResult: PromiseSettledResult<MobileTranslationSession>;
  currentLibrary: MobilePaper[];
  currentPreferences: MobileTranslationSession;
  libraryChanged: boolean;
  preferencesChanged: boolean;
}): {
  library: MobilePaper[];
  preferences: MobileTranslationSession;
  errors: unknown[];
} {
  const library = input.libraryResult.status === 'fulfilled'
    ? input.libraryChanged
      ? mergeHydratedMobileLibrary(input.libraryResult.value, input.currentLibrary)
      : input.libraryResult.value
    : input.currentLibrary;
  const preferences = input.preferencesResult.status === 'fulfilled' && !input.preferencesChanged
    ? input.preferencesResult.value
    : input.currentPreferences;
  const errors = [
    input.libraryResult.status === 'rejected' ? input.libraryResult.reason : undefined,
    input.preferencesResult.status === 'rejected' ? input.preferencesResult.reason : undefined
  ].filter((error) => error !== undefined);
  return { library, preferences, errors };
}
