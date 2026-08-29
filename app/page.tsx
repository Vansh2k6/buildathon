import Link from 'next/link';
import { BookGrid, BookCard } from '@/app/components/BookCard';
import { getFeaturedBooks, getCategoryCounts, type Book } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function Home() {
  const featured = await safe((): Promise<Book[]> => getFeaturedBooks(), []);
  const categories = await safe(() => getCategoryCounts(), []);
  const [hero, ...rest] = featured;

  return (
    <main className="container">
      {/* Featured Hero Banner */}
      <section style={{ marginBottom: '48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span className="badge-featured">HERO SELECTION</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Curated automatically by agent within merchant policy</span>
        </div>

        {hero ? (
          <div className="glass-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px', alignItems: 'center' }}>
            <div style={{ maxWidth: '280px', margin: '0 auto', width: '100%' }}>
              <BookCard book={hero} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '0.85rem', color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                  {hero.category}
                </span>
                <h1 style={{ fontSize: '2.5rem', lineHeight: '1.2', marginTop: '4px', marginBottom: '8px' }}>
                  {hero.name}
                </h1>
                <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  by {hero.author}
                </p>
              </div>

              <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: '1.6' }}>
                {hero.description}
              </p>

              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '12px' }}>
                <Link href="/browse" className="btn btn-primary">
                  Explore Catalog →
                </Link>
                <Link href="/audit" className="btn btn-secondary">
                  View Audit Trail
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-card" style={{ textAlign: 'center', padding: '48px' }}>
            <p className="page-sub" style={{ margin: 0 }}>
              No featured titles yet. Click <strong>Advance Day</strong> in Control Panel or run an agent cycle to curate the shelf.
            </p>
          </div>
        )}
      </section>

      {/* Secondary Featured Section */}
      {rest.length > 0 && (
        <section style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '20px' }}>Also Featured on Shelf</h2>
          <BookGrid books={rest} />
        </section>
      )}

      {/* Collections Grid */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '20px' }}>Browse Collections</h2>
        {categories.length === 0 ? (
          <p className="page-sub">Catalog unavailable — check database seed.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
            {categories.map(({ category, count }) => (
              <Link key={category} href={`/collections/${encodeURIComponent(category)}`} className="glass-card" style={{ padding: '16px', textDecoration: 'none' }}>
                <div style={{ fontWeight: '600', fontSize: '1rem', textTransform: 'capitalize', marginBottom: '4px' }}>
                  {category}
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {count} {count === 1 ? 'title' : 'titles'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
