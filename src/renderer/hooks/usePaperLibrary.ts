import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';
import {
  PAPER_LIBRARY_KEY,
  parsePaperLibraryResult,
  serializePaperLibrary,
  type PaperRecord
} from '../lib/papers';

export interface PaperLibraryState {
  papers: PaperRecord[];
  persistenceBlocked: boolean;
  warning?: string;
}

export function replacePaperInLibrary(library: PaperRecord[], paper: PaperRecord): PaperRecord[] {
  return library.map((item) => (item.id === paper.id ? paper : item));
}

export function removePaperFromLibrary(library: PaperRecord[], paper: PaperRecord): PaperRecord[] {
  return library.filter((item) => item.id !== paper.id);
}

export function replacePapersInLibrary(
  library: PaperRecord[],
  papers: readonly PaperRecord[]
): PaperRecord[] {
  const replacements = new Map(papers.map((paper) => [paper.id, paper]));
  return library.map((paper) => replacements.get(paper.id) ?? paper);
}

export function removePapersFromLibrary(
  library: PaperRecord[],
  paperIds: readonly string[]
): PaperRecord[] {
  const removedIds = new Set(paperIds);
  return library.filter((paper) => !removedIds.has(paper.id));
}

export function createPaperLibraryState(rawValue: string | null): PaperLibraryState {
  const parsed = parsePaperLibraryResult(rawValue);
  return {
    papers: parsed.papers,
    persistenceBlocked: Boolean(parsed.error),
    ...(parsed.error ? { warning: parsed.error } : {})
  };
}

export function markPaperLibraryChanged(state: PaperLibraryState): PaperLibraryState {
  return state.persistenceBlocked ? { ...state, persistenceBlocked: false } : state;
}

export function usePaperLibrary() {
  const [initialPaperLibraryRaw] = useState(() => localStorage.getItem(PAPER_LIBRARY_KEY));
  const [initialState] = useState(() => createPaperLibraryState(initialPaperLibraryRaw));
  const [paperLibrary, setPaperLibraryState] = useState<PaperRecord[]>(initialState.papers);
  const persistenceBlockedRef = useRef(initialState.persistenceBlocked);

  const setPaperLibrary = useCallback<Dispatch<SetStateAction<PaperRecord[]>>>((nextState) => {
    persistenceBlockedRef.current = false;
    setPaperLibraryState(nextState);
  }, []);

  useEffect(() => {
    if (persistenceBlockedRef.current) {
      return;
    }
    localStorage.setItem(PAPER_LIBRARY_KEY, serializePaperLibrary(paperLibrary));
  }, [paperLibrary]);

  const updatePaper = useCallback((paper: PaperRecord) => {
    setPaperLibrary((library) => replacePaperInLibrary(library, paper));
  }, []);

  const removePaper = useCallback((paper: PaperRecord) => {
    setPaperLibrary((library) => removePaperFromLibrary(library, paper));
  }, [setPaperLibrary]);

  const updatePapers = useCallback((papers: PaperRecord[]) => {
    setPaperLibrary((library) => replacePapersInLibrary(library, papers));
  }, [setPaperLibrary]);

  const removePapers = useCallback((paperIds: string[]) => {
    setPaperLibrary((library) => removePapersFromLibrary(library, paperIds));
  }, [setPaperLibrary]);

  return {
    initialPaperLibraryRaw,
    paperLibraryWarning: initialState.warning,
    paperLibrary,
    setPaperLibrary,
    updatePaper,
    removePaper,
    updatePapers,
    removePapers
  };
}
