import Link from 'next/link';
import { BookGrid } from '@/app/components/BookCard';
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
    <main>
      <header className="masthead">
        <span className="brand">Demo Merchant</span>
        <nav>
          <Link href="/browse">Browse</Link>
          <Link href="/audit">Audit</Link>
          <Link href="/policy">Policy</Link>
          <Link href="/control">Control</Link>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">Featured this week</p>
        {hero ? (
          <div className="hero-inner">
            <div className="hero-cover">
              {hero.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero.cover_url} alt={`Cover of ${hero.name}`} />
              ) : (
                <div className="cover-fallback large">
                  <span>{hero.name.slice(0, 1)}</span>
                </div>
              )}
              {hero.discount_pct ? <span className="badge">−{hero.discount_pct}%</span> : null}
            </div>
            <div className="hero-copy">
              <h1>{hero.name}</h1>
              <p className="author">{hero.author}</p>
              <p>{hero.description}</p>
            </div>
          </div>
        ) : (
          <p className="empty">
            No featured titles yet. Apply db/003_seed.sql for the baseline pair — later, the agent
            curates this shelf within policy limits.
          </p>
        )}
        {rest.length > 0 ? (
          <>
            <h2>Also featured</h2>
            <BookGrid books={rest} />
          </>
        ) : null}
      </section>

      <section className="collections">
        <h2>Collections</h2>
        {categories.length === 0 ? (
          <p className="empty">Catalog unavailable — check Supabase seed.</p>
        ) : (
          <div className="cats">
            {categories.map(({ category, count }) => (
              <Link key={category} href={`/collections/${encodeURIComponent(category)}`} className="cat">
                <strong>{category}</strong>
                <span>{count} {count === 1 ? 'title' : 'titles'}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="cta">
        <Link href="/browse" className="button">
          Browse all books →
        </Link>
      </section>
    </main>
  );
}
