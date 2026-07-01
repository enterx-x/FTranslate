import { useEffect, useMemo, useState } from 'react';
import {
  METHOD_CARDS_KEY,
  parseMethodCards,
  serializeMethodCards,
  type MethodCard
} from '../lib/methodCards';

type MethodCardStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readMethodCardsFromStorage(
  storage: MethodCardStorage | undefined = globalThis.localStorage
): MethodCard[] {
  return parseMethodCards(storage?.getItem(METHOD_CARDS_KEY) ?? null);
}

export function writeMethodCardsToStorage(
  cards: MethodCard[],
  storage: MethodCardStorage | undefined = globalThis.localStorage
): void {
  storage?.setItem(METHOD_CARDS_KEY, serializeMethodCards(cards));
}

export function filterMethodCardsByProject(cards: MethodCard[], projectId: string): MethodCard[] {
  return cards.filter((card) => card.projectId === projectId);
}

export function useMethodCards(projectId: string) {
  const [cards, setCards] = useState<MethodCard[]>(() => readMethodCardsFromStorage());
  const methodCards = useMemo(() => filterMethodCardsByProject(cards, projectId), [cards, projectId]);

  useEffect(() => {
    writeMethodCardsToStorage(cards);
  }, [cards]);

  return {
    allMethodCards: cards,
    methodCards,
    setMethodCards: setCards
  };
}
