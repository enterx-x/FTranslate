import {
  normalizeEnglishDictionaryWord,
  parseFreeDictionaryResponse,
  type WordDictionaryLookupResult
} from '../shared/wordDictionary';

const FREE_DICTIONARY_ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const MAX_DICTIONARY_RESPONSE_BYTES = 1_000_000;
const MAX_DICTIONARY_CACHE_ENTRIES = 256;

export class EnglishWordDictionaryService {
  private readonly cache = new Map<string, WordDictionaryLookupResult>();
  private readonly inFlight = new Map<string, Promise<WordDictionaryLookupResult>>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 8_000
  ) {}

  async lookup(value: string): Promise<WordDictionaryLookupResult> {
    const word = normalizeEnglishDictionaryWord(value);
    if (!word) {
      return { status: 'unavailable', message: '只支持查询单个英文单词。' };
    }
    const cached = this.cache.get(word);
    if (cached) {
      this.cache.delete(word);
      this.cache.set(word, cached);
      return cached;
    }
    const pending = this.inFlight.get(word);
    if (pending) {
      return pending;
    }
    const lookup = this.lookupUncached(word).finally(() => this.inFlight.delete(word));
    this.inFlight.set(word, lookup);
    return lookup;
  }

  private async lookupUncached(word: string): Promise<WordDictionaryLookupResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${FREE_DICTIONARY_ENDPOINT}${encodeURIComponent(word)}`, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal
      });
      if (response.status === 404) {
        return this.remember(word, { status: 'not-found', message: '在线词典没有收录该词，已保留本地翻译。' });
      }
      if (!response.ok) {
        return { status: 'unavailable', message: `词典服务暂不可用（HTTP ${response.status}）。` };
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DICTIONARY_RESPONSE_BYTES) {
        controller.abort();
        return { status: 'unavailable', message: '词典响应过大，已停止解析。' };
      }
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, 'utf8') > MAX_DICTIONARY_RESPONSE_BYTES) {
        return { status: 'unavailable', message: '词典响应过大，已停止解析。' };
      }
      const entry = parseFreeDictionaryResponse(JSON.parse(responseText) as unknown);
      if (!entry) {
        return this.remember(word, { status: 'not-found', message: '词典未返回可用释义，已保留本地翻译。' });
      }
      return this.remember(word, { status: 'found', message: '已加载词性、音标和多义项。', entry });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return {
        status: 'unavailable',
        message: timedOut ? '词典查询超时，已保留本地翻译。' : '词典网络不可用，已保留本地翻译。'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(word: string, result: WordDictionaryLookupResult): WordDictionaryLookupResult {
    if (this.cache.has(word)) {
      this.cache.delete(word);
    }
    this.cache.set(word, result);
    while (this.cache.size > MAX_DICTIONARY_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.cache.delete(oldest);
    }
    return result;
  }
}
