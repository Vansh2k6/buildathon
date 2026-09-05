import { effectivePriceP, formatInr, type Book } from '@/lib/catalog';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function BookCard({ book }: { book: Book }) {
  const sale = book.discount_pct ? effectivePriceP(book.price_p, book.discount_pct) : null;
  const soldOut = book.inventory <= 0;
  const lowStock = book.inventory > 0 && book.inventory <= 5;

  return (
    <article className="book-card">
      <div className="book-cover">
        {book.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.cover_url} alt={`Cover of ${book.name}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span>{initials(book.name)}</span>
        )}
        {book.discount_pct && !soldOut ? (
          <span className="badge-discount" style={{ position: 'absolute', top: '10px', left: '10px' }}>
            -{book.discount_pct}% OFF
          </span>
        ) : null}
        {book.is_featured ? (
          <span className="badge-featured" style={{ position: 'absolute', top: '10px', right: '10px' }}>
            Rank #{book.featured_rank ?? 1}
          </span>
        ) : null}
      </div>

      <div className="book-info">
        <h3 className="book-title" title={book.name}>{book.name}</h3>
        <p className="book-author">{book.author || 'Unknown Author'}</p>
        
        <div className="book-meta">
          <div className="price-box">
            {sale !== null ? (
              <>
                <span className="price-sale">{formatInr(sale)}</span>
                <span className="price-old">{formatInr(book.price_p)}</span>
              </>
            ) : (
              <span className="price-sale" style={{ color: 'var(--text-primary)' }}>{formatInr(book.price_p)}</span>
            )}
          </div>
          <span className={`stock-pill ${lowStock ? 'stock-low' : ''}`}>
            {soldOut ? 'Out of stock' : lowStock ? `Only ${book.inventory} left` : `${book.inventory} in stock`}
          </span>
        </div>
      </div>
    </article>
  );
}

export function BookGrid({ books }: { books: Book[] }) {
  if (books.length === 0) {
    return <p className="page-sub">No books match yet — check catalog seed or filter query.</p>;
  }
  return (
    <div className="grid-books">
      {books.map((b) => (
        <BookCard key={b.sku} book={b} />
      ))}
    </div>
  );
}
