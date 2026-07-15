import { buildArxivProxyUpstreamUrl } from '../src/shared/arxivProxy.mjs';

export const config = { maxDuration: 30 };

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: '只允许 GET 请求。' });
    return;
  }

  let upstreamUrl;
  try {
    upstreamUrl = buildArxivProxyUpstreamUrl(request.query ?? {});
  } catch (error) {
    response.status(400).json({ error: formatError(error) });
    return;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/atom+xml',
        'User-Agent': 'FTranslate-Mobile/0.1 (personal academic reader)'
      },
      signal: AbortSignal.timeout(25_000)
    });
    const body = await upstream.text();
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/atom+xml; charset=utf-8');
    response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(upstream.status).send(body);
  } catch (error) {
    response.status(502).json({ error: `arXiv 上游请求失败：${formatError(error)}` });
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
