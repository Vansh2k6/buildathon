import type { SupabaseClient } from '@supabase/supabase-js';
import { serverAdmin } from '@/lib/db';
import type { HeadlineItem, TrendingHeadlinesSignal } from './types';

export const FALLBACK_HEADLINE: HeadlineItem = {
  title:
    'Monsoon rains intensify across Western Ghats; tea and spice plantations brace for heavy downpours',
  description:
    'Heavy rainfall expected across major plantation districts, impacting supply chains and harvest timelines.',
  source: 'fallback',
};

const DOMAINS_QUERY = 'domains=livemint.com,moneycontrol.com,indiatoday.in';
const NEWS_URL = `https://newsapi.org/v2/everything?${DOMAINS_QUERY}&language=en&sortBy=publishedAt&pageSize=20`;

interface NewsApiArticle {
  title?: string | null;
  description?: string | null;
  source?: { name?: string | null } | null;
}

interface NewsApiResponse {
  status?: string;
  articles?: NewsApiArticle[];
}

export async function detectExternalSignal(opts?: {
  newsApiKey?: string;
  fetchTimeoutMs?: number;
  db?: SupabaseClient;
}): Promise<TrendingHeadlinesSignal> {
  const apiKey = opts?.newsApiKey ?? process.env.NEWSAPI_KEY;
  const timeoutMs = opts?.fetchTimeoutMs ?? 8000;
  const fetchedAt = new Date().toISOString();

  let liveHeadlines: HeadlineItem[] = [];
  let fetchFailed = false;
  let rawResponse: unknown = null;

  if (apiKey) {
    try {
      const res = await fetch(NEWS_URL, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        const json = (await res.json()) as NewsApiResponse;
        rawResponse = json;

        if (json.articles && Array.isArray(json.articles)) {
          const valid = json.articles
            .filter((a) => a.title && a.title.trim().length >= 20)
            .slice(0, 8)
            .map((a) => ({
              title: a.title!.trim(),
              description: (a.description ?? '').slice(0, 200).trim(),
              source: a.source?.name ?? 'News',
            }));

          if (valid.length > 0) {
            liveHeadlines = valid;
          } else {
            fetchFailed = true;
          }
        } else {
          fetchFailed = true;
        }
      } else {
        fetchFailed = true;
      }
    } catch {
      fetchFailed = true;
    }
  } else {
    fetchFailed = true;
  }

  const isLive = !fetchFailed && liveHeadlines.length > 0;
  const headlines = isLive ? liveHeadlines : [FALLBACK_HEADLINE];
  const source = isLive ? 'live' : 'fallback';

  // Persist to news_cache table in Supabase
  try {
    const client = opts?.db ?? serverAdmin();
    await client.from('news_cache').insert({
      fetched_at: fetchedAt,
      query: DOMAINS_QUERY,
      source,
      raw: rawResponse ?? { fallback: true },
      used_title: headlines[0]?.title ?? null,
    });
  } catch (err) {
    // Non-fatal if DB insert fails
    console.warn('[observe/external] Warning: failed to write news_cache:', err);
  }

  return {
    kind: 'trending_headlines',
    source,
    fetched_at: fetchedAt,
    headlines,
  };
}
