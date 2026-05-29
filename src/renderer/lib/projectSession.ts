import type { TranslationDocument } from './translation';

export interface FreshPdfSessionState {
  translationDocument: TranslationDocument | null;
  aiCacheDocument: TranslationDocument | null;
  currentParagraphIndex: number;
  aiParagraphIndex: number;
  showTranslation: boolean;
  isEditing: boolean;
  editingText: string;
}

export function buildFreshPdfSessionState(): FreshPdfSessionState {
  return {
    translationDocument: null,
    aiCacheDocument: null,
    currentParagraphIndex: 0,
    aiParagraphIndex: 0,
    showTranslation: false,
    isEditing: false,
    editingText: ''
  };
}
