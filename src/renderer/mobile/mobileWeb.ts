const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org']);

export function buildMobileWebArxivSearchUrl(apiUrl: string, pageUrl = window.location.href): string {
  const upstream = new URL(apiUrl);
  const proxy = new URL('/api/arxiv', pageUrl);
  proxy.search = upstream.search;
  return proxy.toString();
}

export function buildMobileWebPdfUrl(pdfUrl: string, pageUrl = window.location.href): string {
  const upstream = new URL(pdfUrl);
  if (!ARXIV_HOSTS.has(upstream.hostname.toLowerCase()) || !upstream.pathname.startsWith('/pdf/')) {
    return upstream.toString();
  }
  const directPdfPath = upstream.pathname.replace(/\.pdf$/iu, '');
  const proxyPath = `/api/arxiv-pdf${directPdfPath.slice('/pdf'.length)}`;
  const proxy = new URL(proxyPath, pageUrl);
  proxy.search = upstream.search;
  return proxy.toString();
}
