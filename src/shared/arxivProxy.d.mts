export type ArxivProxyQuery = Record<string, string | string[] | undefined>;

export function buildArxivProxyUpstreamUrl(query: ArxivProxyQuery): string;
