import Link from 'next/link';
import { BookGrid } from '@/app/components/BookCard';
import { listBooks, type Book } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = Promise<{ category: string }>;

export default async function CollectionPage({ params }: { params: Params }) {
  const { category: rawCategory } = await params;
  const category = decodeURIComponent(rawCategory);

  let books: Book[] = [];
  let error: string | null = null;
  try {
    books = await listBooks({ category });
  } catch (e) {
    error = e instanceof Error ? e.message : 'catalog unavailable';
  }

  return (
    <main className="container">
      <div style={{ marginBottom: '24px' }}>
        <Link href="/browse" style={{ fontSize: '0.85rem', color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
          ← Back to All Collections
        </Link>
      </div>

      <h1 className="page-title" style={{ textTransform: 'capitalize' }}>
        Collection: {category}
      </h1>
      <p className="page-sub">
        Showing all {books.length} title(s) in the {category} category.
      </p>

      {error ? <p className="page-sub">Catalog unavailable: {error}</p> : <BookGrid books={books} />}
    </main>
  );
}
