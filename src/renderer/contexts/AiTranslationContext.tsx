import type { Dispatch, SetStateAction } from 'react';
import { createRequiredContext } from './createRequiredContext';
import type { TranslationDocument, TranslationItem } from '../lib/translation';

export interface AiTranslationContextValue {
  translationDocument: TranslationDocument | null;
  setTranslationDocument: Dispatch<SetStateAction<TranslationDocument | null>>;
  aiCacheDocument: TranslationDocument | null;
  setAiCacheDocument: Dispatch<SetStateAction<TranslationDocument | null>>;
  currentParagraphIndex: number;
  setCurrentParagraphIndex: Dispatch<SetStateAction<number>>;
  aiParagraphIndex: number;
  setAiParagraphIndex: Dispatch<SetStateAction<number>>;
  currentItem: TranslationItem | null;
}

export const [AiTranslationProvider, useAiTranslationContext] =
  createRequiredContext<AiTranslationContextValue>('AiTranslationContext');
