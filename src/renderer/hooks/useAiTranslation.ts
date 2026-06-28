import { useCallback, useMemo, useState } from 'react';
import {
  cloneJsonDocumentForAi,
  updateAiCacheItem
} from '../lib/aiMode';
import { buildAiCacheDocument } from '../lib/aiMode';
import {
  parseTranslationFile,
  updateTranslationAtIndex,
  type TranslationDocument,
  type TranslationItem
} from '../lib/translation';
import type { ExtractedPdfBlock } from '../lib/pdfTextStructure';
import type { TextFilePayload } from '../types/electron';

export function getTranslationItemAt(
  document: TranslationDocument | null,
  index: number
): TranslationItem | null {
  return document?.items[index] ?? null;
}

export function getRelativeTranslationIndex(currentIndex: number, itemCount: number, delta: number): number {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.min(itemCount - 1, Math.max(0, currentIndex + delta));
}

export function useAiTranslation() {
  const [translationDocument, setTranslationDocument] = useState<TranslationDocument | null>(null);
  const [aiCacheDocument, setAiCacheDocument] = useState<TranslationDocument | null>(null);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  const [aiParagraphIndex, setAiParagraphIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState('');

  const currentItem = useMemo(
    () => getTranslationItemAt(translationDocument, currentParagraphIndex),
    [currentParagraphIndex, translationDocument]
  );

  const applyTranslationPayload = useCallback((payload: TextFilePayload): TranslationDocument => {
    const document = parseTranslationFile(payload.content, payload.fileName, payload.filePath);
    setTranslationDocument(document);
    setAiCacheDocument(cloneJsonDocumentForAi(document));
    setCurrentParagraphIndex(0);
    setAiParagraphIndex(0);
    setShowTranslation(document.kind === 'markdown');
    setIsEditing(false);
    setEditingText('');
    return document;
  }, []);

  const applyAiCachePayload = useCallback((payload: TextFilePayload): TranslationDocument | null => {
    const document = parseTranslationFile(payload.content, payload.fileName, payload.filePath);
    const aiDocument = cloneJsonDocumentForAi(document);
    if (!aiDocument) {
      return null;
    }

    setAiCacheDocument(aiDocument);
    setAiParagraphIndex(0);
    return aiDocument;
  }, []);

  const buildCacheFromPdfBlocks = useCallback((
    blocks: ExtractedPdfBlock[],
    pdfFileName?: string,
    existingDocument?: TranslationDocument | null
  ): TranslationDocument => {
    const document = buildAiCacheDocument(blocks, pdfFileName, existingDocument);
    setAiCacheDocument(document);
    setAiParagraphIndex(0);
    return document;
  }, []);

  const showPreviousParagraph = useCallback(() => {
    setCurrentParagraphIndex((index) =>
      getRelativeTranslationIndex(index, translationDocument?.items.length ?? 0, -1)
    );
    setIsEditing(false);
    setShowTranslation(false);
  }, [translationDocument?.items.length]);

  const showNextParagraph = useCallback(() => {
    setCurrentParagraphIndex((index) =>
      getRelativeTranslationIndex(index, translationDocument?.items.length ?? 0, 1)
    );
    setIsEditing(false);
    setShowTranslation(false);
  }, [translationDocument?.items.length]);

  const showCurrentTranslation = useCallback(() => {
    setShowTranslation(true);
    setIsEditing(false);
  }, []);

  const startEditingCurrentTranslation = useCallback(() => {
    const item = translationDocument?.items[currentParagraphIndex];
    if (!item) {
      return;
    }
    setEditingText(item.translation);
    setIsEditing(true);
    setShowTranslation(true);
  }, [currentParagraphIndex, translationDocument]);

  const applyCurrentEdit = useCallback((): TranslationDocument | null => {
    if (!translationDocument) {
      return null;
    }

    const nextDocument = updateTranslationAtIndex(translationDocument, currentParagraphIndex, editingText);
    setTranslationDocument(nextDocument);
    setAiCacheDocument((document) =>
      document
        ? updateAiCacheItem(document, currentParagraphIndex, {
            translation: editingText,
            translatedAt: new Date().toISOString()
          })
        : document
    );
    setIsEditing(false);
    setShowTranslation(true);
    return nextDocument;
  }, [currentParagraphIndex, editingText, translationDocument]);

  const resetParagraphDisplay = useCallback(() => {
    setIsEditing(false);
    setShowTranslation(false);
    setEditingText('');
  }, []);

  const getCurrentPromptItem = useCallback((): TranslationItem | null => {
    const document = aiCacheDocument ?? translationDocument;
    return getTranslationItemAt(document, aiParagraphIndex);
  }, [aiCacheDocument, aiParagraphIndex, translationDocument]);

  const getPromptItemsForFullDocument = useCallback((): TranslationItem[] => {
    const document = aiCacheDocument ?? translationDocument;
    return document?.items ?? [];
  }, [aiCacheDocument, translationDocument]);

  return {
    translationDocument,
    setTranslationDocument,
    aiCacheDocument,
    setAiCacheDocument,
    currentParagraphIndex,
    setCurrentParagraphIndex,
    aiParagraphIndex,
    setAiParagraphIndex,
    showTranslation,
    setShowTranslation,
    isEditing,
    setIsEditing,
    editingText,
    setEditingText,
    currentItem,
    applyTranslationPayload,
    applyAiCachePayload,
    buildCacheFromPdfBlocks,
    showPreviousParagraph,
    showNextParagraph,
    showCurrentTranslation,
    startEditingCurrentTranslation,
    applyCurrentEdit,
    resetParagraphDisplay,
    getCurrentPromptItem,
    getPromptItemsForFullDocument
  };
}
