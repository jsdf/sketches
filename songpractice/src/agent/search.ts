/**
 * Web search and page reading for the DeepSeek agent. DeepSeek has no server
 * side search, so these run from the device against whichever backend the user
 * has configured.
 */
import {SearchProvider, Settings} from './types';

export type SearchResult = {title: string; url: string; snippet: string};

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function activeSearchProvider(settings: Settings): SearchProvider {
  if (settings.searchProvider === 'tavily' && settings.tavilyKey) return 'tavily';
  if (settings.searchProvider === 'brave' && settings.braveKey) return 'brave';
  return 'duckduckgo';
}

export async function webSearch(query: string, settings: Settings): Promise<SearchResult[]> {
  switch (activeSearchProvider(settings)) {
    case 'tavily':
      return tavilySearch(query, settings.tavilyKey);
    case 'brave':
      return braveSearch(query, settings.braveKey);
    default:
      return duckSearch(query);
  }
}

async function tavilySearch(query: string, key: string): Promise<SearchResult[]> {
  const res = await withTimeout(
    (signal) =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({api_key: key, query, max_results: 6, search_depth: 'basic'}),
        signal,
      }),
    20000,
  );
  if (!res.ok) throw new Error(`Tavily search failed (${res.status})`);
  const json = await res.json();
  return (json.results ?? []).map((r: any) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.content ?? '').slice(0, 600),
  }));
}

async function braveSearch(query: string, key: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`;
  const res = await withTimeout(
    (signal) => fetch(url, {headers: {Accept: 'application/json', 'X-Subscription-Token': key}, signal}),
    20000,
  );
  if (!res.ok) throw new Error(`Brave search failed (${res.status})`);
  const json = await res.json();
  return (json.web?.results ?? []).map((r: any) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: stripHtml(String(r.description ?? '')).slice(0, 600),
  }));
}

/** Keyless fallback. Best effort: DuckDuckGo may rate-limit or change markup. */
async function duckSearch(query: string): Promise<SearchResult[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const res = await withTimeout(
    (signal) => fetch(url, {headers: {'User-Agent': UA, Accept: 'text/html'}, signal}),
    20000,
  );
  if (!res.ok) throw new Error(`DuckDuckGo search failed (${res.status})`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && results.length < 8) {
    const href = decodeEntities(m[1]);
    results.push({title: stripHtml(m[2]).trim(), url: unwrapDuckUrl(href), snippet: ''});
  }
  if (results.length === 0) {
    // Older markup: plain anchors carrying a uddg redirect parameter.
    const altRe = /href="(\/\/duckduckgo\.com\/l\/\?uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = altRe.exec(html)) && results.length < 8) {
      results.push({title: stripHtml(m[2]).trim(), url: unwrapDuckUrl(decodeEntities(m[1])), snippet: ''});
    }
  }
  const snippetRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  let i = 0;
  while ((m = snippetRe.exec(html)) && i < results.length) {
    results[i].snippet = stripHtml(m[1]).trim().slice(0, 600);
    i++;
  }
  return results.filter((r) => r.url.startsWith('http'));
}

function unwrapDuckUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith('//') ? 'https:' + href : href;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/', '#47': '/',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (ENTITIES[code]) return ENTITIES[code];
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (Number.isFinite(n)) return String.fromCharCode(n);
    }
    return whole;
  });
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|pre|section|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

/** Fetches a page and returns readable text, truncated to fit the context. */
export async function fetchPage(url: string, maxChars = 7000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be opened');
  const res = await withTimeout(
    (signal) =>
      fetch(url, {
        headers: {'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain'},
        signal,
      }),
    25000,
  );
  if (!res.ok) throw new Error(`Could not open page (${res.status})`);
  const type = res.headers.get('content-type') ?? '';
  const body = await res.text();
  const text = type.includes('text/plain') ? body : stripHtml(body);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n[truncated, ${text.length - maxChars} more characters]`;
}
