export type ArxivProxyQuery = Record<string, string | string[] | undefined>;

export function buildArxivProxyUpstreamUrl(query: ArxivProxyQuery): string;
export function buildArxivHtmlFallbackUrl(query: ArxivProxyQuery): string;
export function readArxivFallbackCategory(query: ArxivProxyQuery): string;
export function convertArxivSearchHtmlToAtom(
  html: string,
  options?: { category?: string; start?: number; maxResults?: number }
): string;
