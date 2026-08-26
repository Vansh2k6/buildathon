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
  return (
    <article className="book-card">
      <div className="cover">
        {book.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.cover_url} alt={`Cover of ${book.name}`} />
        ) : (
          <div className="cover-fallback" data-hue={book.sku.length * 37 % 360}>
            <span>{initials(book.name)}</span>
          </div>
        )}
        {book.discount_pct && !soldOut ? (
          <span className="badge">−{book.discount_pct}%</span>
        ) : null}
      </div>
      <h3 title={book.name}>{book.name}</h3>
      <p className="author">{book.author || ' '}</p>
      <p className="price">
        {sale !== null ? (
          <>
            <s>{formatInr(book.price_p)}</s> <strong>{formatInr(sale)}</strong>
          </>
        ) : (
          <strong>{formatInr(book.price_p)}</strong>
        )}
        {soldOut ? <em className="soldout"> · sold out</em> : null}
      </p>
    </article>
  );
}

export function BookGrid({ books }: { books: Book[] }) {
  if (books.length === 0) {
    return <p className="empty">No books match yet — apply db/*.sql or import a dataset.</p>;
  }
  return (
    <div className="grid">
      {books.map((b) => (
        <BookCard key={b.sku} book={b} />
      ))}
    </div>
  );
}
