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
    <main>
      <header className="masthead">
        <Link href="/" className="brand">
          ← Demo Merchant
        </Link>
      </header>

      <p className="eyebrow">Collection</p>
      <h1>{category}</h1>
      <p>
        <Link href="/browse">Browse everything →</Link>
      </p>

      {error ? <p className="empty">Catalog unavailable: {error}</p> : <BookGrid books={books} />}
    </main>
  );
}
