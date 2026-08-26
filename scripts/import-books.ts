/**
 * import-books.ts — ingest a real book dataset into `products` (ADR-019).
 *
 * Usage:   npm run books:import
 * Input:   data/books.json — an array of:
 * {
 *   "sku": "BK-101",            // required, unique
 *   "title": "...",             // required → products.name
 *   "author": "...",            // optional, default ''
 *   "category": "fiction",      // required (collections are built from these)
 *   "priceInr": 499,            // required, rupees
 *   "costInr": 300,             // required for the margin floor to mean anything
 *   "inventory": 42,            // optional, default 0
 *   "description": "...",       // optional
 *   "coverUrl": "https://…"     // optional; gradient fallback when absent
 * }
 *
 * Upserts by sku; never deletes titles absent from the file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './_env.ts';

loadEnv();

interface InputBook {
  sku: string;
  title: string;
  author?: string;
  category: string;
  priceInr: number;
  costInr?: number;
  inventory?: number;
  description?: string;
  coverUrl?: string | null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env in .env.local');

  const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'books.json'), 'utf8')) as InputBook[];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('data/books.json must be a non-empty array');

  const rows = raw.map((b, i) => {
    for (const field of ['sku', 'title', 'category', 'priceInr'] as const) {
      if (!b[field]) throw new Error(`book[${i}]: missing "${field}"`);
    }
    return {
      sku: b.sku,
      name: b.title,
      author: b.author ?? '',
      category: b.category,
      description: b.description ?? '',
      price_p: Math.round(b.priceInr * 100),
      cost_p: Math.round((b.costInr ?? 0) * 100),
      inventory: b.inventory ?? 0,
      cover_url: b.coverUrl ?? null,
    };
  });

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { error } = await db.from('products').upsert(rows, { onConflict: 'sku' });
  if (error) throw new Error(error.message);
  console.log(`Upserted ${rows.length} books (${[...new Set(rows.map((r) => r.category))].length} categories).`);
}

main().catch((e) => {
  console.error('IMPORT FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
