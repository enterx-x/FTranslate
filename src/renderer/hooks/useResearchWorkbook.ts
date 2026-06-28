import { useEffect, useRef, useState } from 'react';
import {
  RESEARCH_SHEET_LINKS_KEY,
  RESEARCH_WORKBOOK_KEY,
  migrateLegacyPaperSheetCells,
  parseResearchSheetLinks,
  parseResearchWorkbook,
  serializeResearchSheetLinks,
  serializeResearchWorkbook,
  type ResearchSheetLink,
  type ResearchWorkbook
} from '../lib/researchWorkbook';
import type { PaperRecord } from '../lib/papers';

export type LegacyPaperWithSheetCells = PaperRecord & { sheetCells?: Record<string, string> };

export function readLegacyPapersWithSheetCells(
  rawValue: string | null,
  papers: PaperRecord[]
): LegacyPaperWithSheetCells[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const legacyPapers: LegacyPaperWithSheetCells[] = [];

    parsed.forEach((entry) => {
      if (!isObjectRecord(entry) || !isObjectRecord(entry.sheetCells)) {
        return;
      }

      const rawId = typeof entry.id === 'string' ? entry.id : '';
      const rawPdfPath = typeof entry.pdfPath === 'string' ? entry.pdfPath : '';
      const paper = papers.find(
        (item) =>
          (rawId && item.id === rawId) ||
          (rawPdfPath && normalizeLegacyPaperPath(item.pdfPath) === normalizeLegacyPaperPath(rawPdfPath))
      );

      if (!paper) {
        return;
      }

      legacyPapers.push({
        ...paper,
        sheetCells: Object.fromEntries(
          Object.entries(entry.sheetCells)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, String(value)])
        )
      });
    });

    return legacyPapers;
  } catch {
    return [];
  }
}

export function useResearchWorkbook(legacyPapers: LegacyPaperWithSheetCells[] = []) {
  const [researchWorkbook, setResearchWorkbook] = useState<ResearchWorkbook>(() =>
    parseResearchWorkbook(localStorage.getItem(RESEARCH_WORKBOOK_KEY))
  );
  const [researchSheetLinks, setResearchSheetLinks] = useState<ResearchSheetLink[]>(() =>
    parseResearchSheetLinks(localStorage.getItem(RESEARCH_SHEET_LINKS_KEY))
  );
  const didMigrateLegacySheetCellsRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(RESEARCH_WORKBOOK_KEY, serializeResearchWorkbook(researchWorkbook));
  }, [researchWorkbook]);

  useEffect(() => {
    localStorage.setItem(RESEARCH_SHEET_LINKS_KEY, serializeResearchSheetLinks(researchSheetLinks));
  }, [researchSheetLinks]);

  useEffect(() => {
    if (didMigrateLegacySheetCellsRef.current || legacyPapers.length === 0) {
      return;
    }

    didMigrateLegacySheetCellsRef.current = true;
    const migrated = migrateLegacyPaperSheetCells(researchWorkbook, researchSheetLinks, legacyPapers);
    setResearchWorkbook(migrated.workbook);
    setResearchSheetLinks(migrated.links);
  }, [legacyPapers, researchSheetLinks, researchWorkbook]);

  return {
    researchWorkbook,
    setResearchWorkbook,
    researchSheetLinks,
    setResearchSheetLinks
  };
}

function normalizeLegacyPaperPath(value: string): string {
  return value.trim().replace(/\\/gu, '/').toLowerCase();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
