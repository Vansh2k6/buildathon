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
    <main>
      <header className="masthead">
        <Link href="/" className="brand">
          ← Demo Merchant
        </Link>
      </header>

      <h1>Browse the shop</h1>

      <form className="filters" method="GET" action="/browse">
        <input type="search" name="q" placeholder="Title or author…" defaultValue={query.q ?? ''} />
        <select name="category" defaultValue={query.category ?? ''}>
          <option value="">All collections</option>
          {categories.map(({ category, count }) => (
            <option key={category} value={category}>
              {category} ({count})
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={query.sort ?? ''}>
          <option value="">Sort: title A–Z</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
        </select>
        <button type="submit">Apply</button>
        {query.q || query.category || query.sort ? (
          <Link href="/browse" className="clear">
            Clear
          </Link>
        ) : null}
      </form>

      {error ? <p className="empty">Catalog unavailable: {error}</p> : <BookGrid books={books} />}
    </main>
  );
}
