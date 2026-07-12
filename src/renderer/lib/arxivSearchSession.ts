export interface ArxivSearchSessionController {
  begin: () => number;
  current: () => number | null;
  isCurrent: (sessionId: number) => boolean;
}

let nextArxivSearchSessionId = Date.now() * 1_000;

export function createArxivSearchSessionController(): ArxivSearchSessionController {
  let currentSessionId: number | null = null;

  return {
    begin: () => {
      nextArxivSearchSessionId += 1;
      const nextSessionId = nextArxivSearchSessionId;
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
