/**
 * pick-csv-books.ts — select a few titles per genre from BooksDatasetClean.csv
 * and emit data/books.json for `npm run books:import` (ADR-019 pipeline).
 *
 * Usage:   npx tsx scripts/pick-csv-books.ts [csvPath] [perGenre]
 * Input:   BooksDatasetClean.csv (Title, Authors, Description, Category,
 *          Publisher, Price Starting With ($), Publish Date (Month/Year))
 * Output:  data/books.json — array of InputBook for scripts/import-books.ts
 *
 * Deterministic: file order, first N qualifying titles per genre, global
 * title dedupe, prefers titles that carry a real description.
 * USD → INR at 83; cost = 55% of price so the margin floor can bind.
 * Never sets is_featured — the agent curates the featured shelf itself.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, process.argv[2] ?? 'BooksDatasetClean.csv');
const PER_GENRE = Number(process.argv[3] ?? 4);
const OUT = join(ROOT, 'data', 'books.json');
const USD_TO_INR = 83;

/** Dataset genre → store category slug. Genres absent here are skipped. */
const GENRE_MAP: Record<string, string> = {
  'Fiction': 'fiction',
  'Juvenile Fiction': 'children',
  'Young Adult Fiction': 'young-adult',
  'Biography & Autobiography': 'biography',
  'History': 'history',
  'Cooking': 'cooking',
  'Religion': 'religion',
  'Business & Economics': 'business',
  'Travel': 'travel',
  'Sports & Recreation': 'sports',
  'Self-help': 'self-help',
  'Health & Fitness': 'wellness',
  'Science': 'science',
  'Poetry': 'poetry',
  'Nature': 'nature',
  'Pets': 'pets',
  'Humor': 'humor',
  'True Crime': 'true-crime',
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** "By Grumbach, Doris" → "Doris Grumbach"; multi-author → "First Author et al." */
function cleanAuthor(raw: string): string {
  let a = raw.trim().replace(/^By\s+/i, '').replace(/\s*\((EDT|COM|COR|CON)\)/gi, '');
  a = a.replace(/\s+/g, ' ').trim();
  if (!a) return '';
  const parts = a.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const [last, first, ...rest] = parts;
  // "Last, First" only when the remainder looks like a given name, not more authors
  if (rest.length === 0 && first && /^[A-Z][a-zA-Z.\- ]*$/.test(first)) return `${first} ${last}`;
  return `${last} et al.`;
}

function toPaise(usd: string): number {
  const inr = parseFloat(usd) * USD_TO_INR;
  if (!Number.isFinite(inr) || inr <= 0) return 29900;
  return Math.min(199900, Math.max(9900, Math.round(inr * 100))); // clamp in paise
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

interface CsvRow {
  title: string; author: string; description: string;
  genre: string; publisher: string; year: string; price: string;
}

const lines = readFileSync(CSV, 'utf8').split(/\r?\n/);
const perGenre = new Map<string, CsvRow[]>();
const seenTitles = new Set<string>();

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const f = parseCsvLine(line);
  if (f.length < 8) continue;
  const [title, authors, description, category, publisher, price, , year] = f.map((s) => s.trim());
  if (!title || seenTitles.has(title.toLowerCase())) continue;
  const genre = (category || '').split(',')[0].trim();
  const slug = GENRE_MAP[genre];
  if (!slug) continue;
  seenTitles.add(title.toLowerCase());
  const bucket = perGenre.get(slug) ?? [];
  bucket.push({ title, author: cleanAuthor(authors), description, genre: slug, publisher, year, price });
  perGenre.set(slug, bucket);
}

const picked: Array<{ sku: string; title: string; author: string; category: string; priceInr: number; costInr: number; inventory: number; description: string }> = [];
const summary: string[] = [];

for (const slug of [...perGenre.keys()].sort()) {
  const bucket = perGenre.get(slug)!;
  // prefer titles with a real description, keep file order within each pass
  const chosen = [
    ...bucket.filter((b) => b.description),
    ...bucket.filter((b) => !b.description),
  ].slice(0, PER_GENRE);
  summary.push(`${slug}: ${chosen.length}/${bucket.length}`);
  for (const b of chosen) {
    const priceP = toPaise(b.price);
    const description = b.description
      ? truncate(b.description.replace(/\s+/g, ' ').trim(), 220)
      : truncate(`Published by ${b.publisher}${b.year ? `, ${b.year}` : ''}.`, 220);
    picked.push({
      sku: `BK-${200 + picked.length + 1}`,
      title: b.title,
      author: b.author,
      category: slug,
      priceInr: priceP / 100,
      costInr: Math.round(priceP * 0.55) / 100,
      inventory: 8 + (hash(b.title) % 55),
      description,
    });
  }
}

if (picked.length === 0) throw new Error('no books matched GENRE_MAP — check the CSV path/category names');
if (existsSync(OUT)) console.log('Overwriting existing data/books.json');
writeFileSync(OUT, `${JSON.stringify(picked, null, 2)}\n`);
console.log(`Picked ${picked.length} books across ${perGenre.size} genres → data/books.json`);
console.log(summary.join('  '));
