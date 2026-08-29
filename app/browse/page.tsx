import Link from 'next/link';
import { BookGrid } from '@/app/components/BookCard';
import { getCategoryCounts, listBooks, type Book, type BrowseQuery } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SearchParams = Promise<{ q?: string; category?: string; sort?: string }>;

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const query: BrowseQuery = {
    q: sp.q,
    category: sp.category || undefined,
    sort: (sp.sort as BrowseQuery['sort']) || undefined,
  };

  let books: Book[] = [];
  let categories: Array<{ category: string; count: number }> = [];
  let error: string | null = null;
  try {
    [books, categories] = await Promise.all([listBooks(query), getCategoryCounts()]);
  } catch (e) {
    error = e instanceof Error ? e.message : 'catalog unavailable';
  }

  return (
    <main className="container">
      <h1 className="page-title">Browse Bookstore Catalog</h1>
      <p className="page-sub">
        Explore full bookstore inventory. Real-time prices reflect active agent promotional discounts.
      </p>

      {/* Filter Form */}
      <div className="glass-card" style={{ marginBottom: '32px', padding: '16px 24px' }}>
        <form style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }} method="GET" action="/browse">
          <input
            type="search"
            name="q"
            placeholder="Search by title or author…"
            defaultValue={query.q ?? ''}
            style={{
              flex: '1 1 240px',
              padding: '10px 14px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-body)',
            }}
          />
          <select
            name="category"
            defaultValue={query.category ?? ''}
            style={{
              padding: '10px 14px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-body)',
            }}
          >
            <option value="">All Categories</option>
            {categories.map(({ category, count }) => (
              <option key={category} value={category}>
                {category} ({count})
              </option>
            ))}
          </select>

          <select
            name="sort"
            defaultValue={query.sort ?? ''}
            style={{
              padding: '10px 14px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-body)',
            }}
          >
            <option value="">Sort: Title A–Z</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>

          <button type="submit" className="btn btn-primary">
            Apply Filters
          </button>
          {query.q || query.category || query.sort ? (
            <Link href="/browse" className="btn btn-secondary" style={{ padding: '10px 14px' }}>
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      {error ? <p className="page-sub">Catalog unavailable: {error}</p> : <BookGrid books={books} />}
    </main>
  );
}
