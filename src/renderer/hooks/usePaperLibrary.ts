import { useCallback, useEffect, useState } from 'react';
import {
  PAPER_LIBRARY_KEY,
  parsePaperLibrary,
  serializePaperLibrary,
  type PaperRecord
} from '../lib/papers';

export function replacePaperInLibrary(library: PaperRecord[], paper: PaperRecord): PaperRecord[] {
  return library.map((item) => (item.id === paper.id ? paper : item));
}

export function removePaperFromLibrary(library: PaperRecord[], paper: PaperRecord): PaperRecord[] {
  return library.filter((item) => item.id !== paper.id);
}

export function usePaperLibrary() {
  const [initialPaperLibraryRaw] = useState(() => localStorage.getItem(PAPER_LIBRARY_KEY));
  const [paperLibrary, setPaperLibrary] = useState<PaperRecord[]>(() =>
    parsePaperLibrary(initialPaperLibraryRaw)
  );

  useEffect(() => {
    localStorage.setItem(PAPER_LIBRARY_KEY, serializePaperLibrary(paperLibrary));
  }, [paperLibrary]);

  const updatePaper = useCallback((paper: PaperRecord) => {
    setPaperLibrary((library) => replacePaperInLibrary(library, paper));
  }, []);

  const removePaper = useCallback((paper: PaperRecord) => {
    setPaperLibrary((library) => removePaperFromLibrary(library, paper));
  }, []);

  return {
    initialPaperLibraryRaw,
    paperLibrary,
    setPaperLibrary,
    updatePaper,
    removePaper
  };
}
