import {
  buildArxivHtmlFallbackUrl,
  buildArxivProxyUpstreamUrl,
  convertArxivSearchHtmlToAtom,
  readArxivFallbackCategory
} from '../src/shared/arxivProxy.mjs';

export const config = { maxDuration: 30 };

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: '只允许 GET 请求。' });
    return;
  }

  let fallbackUrl;
  try {
    buildArxivProxyUpstreamUrl(request.query ?? {});
    fallbackUrl = buildArxivHtmlFallbackUrl(request.query ?? {});
  } catch (error) {
    response.status(400).json({ error: formatError(error) });
    return;
  }

  try {
    const fallback = await fetch(fallbackUrl, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'FTranslate-Mobile/0.1 (personal academic reader)'
      },
      signal: AbortSignal.timeout(25_000)
    });
    if (!fallback.ok) {
      throw new Error(`官网搜索返回 HTTP ${fallback.status}`);
    }
    const atom = convertArxivSearchHtmlToAtom(await fallback.text(), {
      category: readArxivFallbackCategory(request.query ?? {}),
      start: Number(request.query?.start ?? 0),
      maxResults: Number(request.query?.max_results ?? 20)
    });
    sendAtom(response, atom, 'official-search');
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Retry-After', '30');
    response.status(503).json({ error: `arXiv 暂时繁忙，已尝试备用检索；请稍后点击刷新。${formatError(error)}` });
  }
}

function sendAtom(response, body, source) {
  response.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
  response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-FTranslate-Arxiv-Source', source);
  response.status(200).send(body);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
