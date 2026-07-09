export interface ArxivSearchSessionController {
  begin: () => number;
  current: () => number | null;
  isCurrent: (sessionId: number) => boolean;
}

export function createArxivSearchSessionController(): ArxivSearchSessionController {
  let currentSessionId: number | null = null;

  return {
    begin: () => {
      const nextSessionId = (currentSessionId ?? 0) + 1;
      currentSessionId = nextSessionId;
      return nextSessionId;
    },
    current: () => currentSessionId,
    isCurrent: (sessionId) => currentSessionId === sessionId
  };
}

export function tryBeginArxivSearchSession(
  controller: ArxivSearchSessionController,
  isSearchAllowed: boolean
): number | null {
  return isSearchAllowed ? controller.begin() : null;
}
