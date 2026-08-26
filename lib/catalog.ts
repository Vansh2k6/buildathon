import { publicRead } from '@/lib/db';

/**
 * The one catalog module every surface reads through.
 * MON-4: effective price is computed HERE and nowhere else — pages,
 * /api/catalog, the policy engine and execution must never inline
 * `price * (1 - pct/100)` themselves.
 */

export type Book = {
  id: string;
  sku: string;
  name: string;
  author: string;
  description: string;
  category: string;
  price_p: number;
  inventory: number;
  is_featured: boolean;
  featured_rank: number | null;
  cover_url: string | null;
  discount_pct: number | null; // active discount, joined from discounts
};

/** Integer-paise effective price under an active discount percentage. */
export function effectivePriceP(priceP: number, discountPct: number): number {
  return Math.floor((priceP * (100 - discountPct)) / 100);
}

export function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

type Row = Omit<Book, 'discount_pct'> & { id: string };

async function attachActiveDiscounts(rows: Row[]): Promise<Book[]> {
  const { data, error } = await publicRead()
    .from('discounts')
    .select('product_id, pct')
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  const byProduct = new Map<string, number>();
  for (const d of (data ?? []) as Array<{ product_id: string; pct: number }>) {
    byProduct.set(d.product_id, d.pct);
  }
  return rows.map((r) => ({ ...r, discount_pct: byProduct.get(r.id) ?? null }));
}

const COLUMNS =
  'id, sku, name, author, description, category, price_p, inventory, is_featured, featured_rank, cover_url';

/** Featured titles for the home hero, rank 1 first. */
export async function getFeaturedBooks(): Promise<Book[]> {
  const { data, error } = await publicRead()
    .from('products')
    .select(COLUMNS)
    .eq('is_featured', true)
    .order('featured_rank', { ascending: true });
  if (error) throw new Error(error.message);
  return attachActiveDiscounts((data ?? []) as Row[]);
}

/** Distinct categories with book counts, alphabetical — drives the collections strip. */
export async function getCategoryCounts(): Promise<Array<{ category: string; count: number }>> {
  const { data, error } = await publicRead().from('products').select('category');
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ category: string }>) {
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export type BrowseQuery = {
  q?: string;
  category?: string;
  sort?: 'title' | 'price_asc' | 'price_desc';
};

/** The browse/collections grid query. */
export async function listBooks(query: BrowseQuery): Promise<Book[]> {
  let req = publicRead().from('products').select(COLUMNS);
  const q = query.q?.trim();
  if (q) req = req.or(`name.ilike.%${q}%,author.ilike.%${q}%`);
  if (query.category) req = req.eq('category', query.category);
  switch (query.sort) {
    case 'price_asc':
      req = req.order('price_p', { ascending: true });
      break;
    case 'price_desc':
      req = req.order('price_p', { ascending: false });
      break;
    default:
      req = req.order('name', { ascending: true });
  }
  const { data, error } = await req;
  if (error) throw new Error(error.message);
  return attachActiveDiscounts((data ?? []) as Row[]);
}
