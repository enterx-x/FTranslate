import {
  buildExperimentMatrixRowsFromMethodCard,
  type ExperimentMatrixRow
} from './experimentMatrix';
import type { MethodCard } from './methodCards';

export interface MethodCardExperimentBridgeSummary {
  methodCardCount: number;
  groundedMethodCardCount: number;
  generatedRowCount: number;
  evidenceLocatorCount: number;
}

export function buildExperimentRowsFromProjectMethodCards(
  cards: MethodCard[],
  projectId: string
): ExperimentMatrixRow[] {
  return cards
    .filter((card) => card.projectId === projectId)
    .flatMap(buildExperimentMatrixRowsFromMethodCard)
    .filter((row) => row.evidenceSourceIds.length > 0 || row.evidenceLocators.length > 0);
}

export function summarizeMethodCardExperimentBridge(
  cards: MethodCard[],
  projectId: string
): MethodCardExperimentBridgeSummary {
  const projectCards = cards.filter((card) => card.projectId === projectId);
  const rowsByMethodCardId = new Map<string, ExperimentMatrixRow[]>();
  const evidenceLocators = new Set<string>();

  for (const card of projectCards) {
    const rows = buildExperimentMatrixRowsFromMethodCard(card).filter(
      (row) => row.evidenceSourceIds.length > 0 || row.evidenceLocators.length > 0
    );
    rowsByMethodCardId.set(card.id, rows);
    rows.forEach((row) => row.evidenceLocators.forEach((locator) => evidenceLocators.add(locator)));
  }

  return {
    methodCardCount: projectCards.length,
    groundedMethodCardCount: Array.from(rowsByMethodCardId.values()).filter((rows) => rows.length > 0).length,
    generatedRowCount: Array.from(rowsByMethodCardId.values()).reduce((total, rows) => total + rows.length, 0),
    evidenceLocatorCount: evidenceLocators.size
  };
}
