import type { Dispatch, SetStateAction } from 'react';
import { createRequiredContext } from './createRequiredContext';
import type { PaperRecord } from '../lib/papers';
import type { ResearchSheetLink, ResearchWorkbook } from '../lib/researchWorkbook';

export interface PaperLibraryContextValue {
  paperLibrary: PaperRecord[];
  setPaperLibrary: Dispatch<SetStateAction<PaperRecord[]>>;
  activePaperId: string | null;
  setActivePaperId: Dispatch<SetStateAction<string | null>>;
  activePaper: PaperRecord | null;
  researchWorkbook: ResearchWorkbook;
  setResearchWorkbook: Dispatch<SetStateAction<ResearchWorkbook>>;
  researchSheetLinks: ResearchSheetLink[];
  setResearchSheetLinks: Dispatch<SetStateAction<ResearchSheetLink[]>>;
}

export const [PaperLibraryProvider, usePaperLibraryContext] =
  createRequiredContext<PaperLibraryContextValue>('PaperLibraryContext');
