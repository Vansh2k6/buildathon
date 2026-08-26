/**
 * T-03 — NewsAPI probe.
 * Done when: 20 real titles printed; observed lag noted; 2–3 catalog
 * categories chosen from what actually appears.
 */
import { loadEnv, requireKey } from './_env.ts';

loadEnv();
const KEY = requireKey('NEWSAPI_KEY');

interface Article { title: string; description: string | null; source: { name: string }; publishedAt: string }

const CATEGORY_BETS: Array<{ category: string; re: RegExp }> = [
  { category: 'monsoon/rain', re: /\b(monsoon|rain|rainfall|flood|downpour|imd)\b/i },
  { category: 'cricket/sports', re: /\b(cricket|match|series|t20|odi|world cup|ipl|wicket)\b/i },
  { category: 'air quality/AQI', re: /\b(aqi|air quality|pollution|smog)\b/i },
  { category: 'heatwave', re: /\b(heatwave|heat wave|temperature[s]? (soar|rise)|scorching)\b/i },
];

async function main(): Promise<void> {
  // Free-plan reality (probed 2026-08-26):
  //   · top-headlines?country=in → HTTP 200 but ZERO results (US-only on free plan)
  //   · top-headlines?sources=<indian> → works but ~5-year-stale index
  //   · everything?domains=<indian outlets>&sortBy=publishedAt → FRESH (≤2d)
  //     Fresh-indexed outlets: livemint.com (1704), moneycontrol.com (103),
  //     indiatoday.in (26). TOI/NDTV/IndianExpress return ZERO on free plan.
  // So Phase 3's external fetch must use /v2/everything with named domains.
  const url = 'https://newsapi.org/v2/everything?domains=livemint.com,moneycontrol.com,indiatoday.in&language=en&sortBy=publishedAt&pageSize=20';
  const res = await fetch(url, { headers: { 'X-Api-Key': KEY }, signal: AbortSignal.timeout(15_000) });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  for (const [h, v] of res.headers) {
    if (h.toLowerCase().startsWith('x-ratelimit')) console.log(`  ${h}: ${v}`);
  }
  if (!res.ok) {
    console.error('Body:', await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as { status: string; totalResults: number; articles: Article[] };
  const now = Date.now();
  console.log(`status=${data.status} totalResults=${data.totalResults} returned=${data.articles.length}\n`);

  const counts = new Map<string, number>();
  data.articles.forEach((a, i) => {
    const ageMin = Math.round((now - new Date(a.publishedAt).getTime()) / 60_000);
    const age = ageMin < 90 ? `${ageMin}min ago` : `${Math.round(ageMin / 60)}h ago`;
    console.log(`${String(i + 1).padStart(2)}. [${age}] ${a.title}`);
    console.log(`     — ${a.source.name}`);

    const text = `${a.title} ${a.description ?? ''}`;
    for (const bet of CATEGORY_BETS) {
      if (bet.re.test(text)) counts.set(bet.category, (counts.get(bet.category) ?? 0) + 1);
    }
  });

  const ages = data.articles.map((a) => (now - new Date(a.publishedAt).getTime()) / 60_000);
  console.log(`\nFreshness: median lag ~${Math.round(median(ages))}min, oldest ~${Math.round(Math.max(...ages) / 60)}h\n`);

  console.log('Category candidates (from what ACTUALLY appeared):');
  for (const bet of CATEGORY_BETS) {
    console.log(`  ${counts.get(bet.category) ?? 0}× ${bet.category}`);
  }
  const ranked = [...counts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`\nShortlist suggestion: ${ranked.map(([c, n]) => `${c} (${n})`).join(' · ') || 'NONE — pick manually'}`);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

main().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
