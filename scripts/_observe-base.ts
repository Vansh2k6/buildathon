/**
 * _observe-base.ts — Shared HTTP client + storefront snapshot helpers for the observe-* scripts.
 * Not a runnable script; consumed by observe-internal.ts / observe-external.ts / observe-buyer.ts.
 */

const DEFAULT_BASE = process.env.MERCHANT_AGENT_BASE_URL ?? 'http://localhost:3000';

export type CatalogRow = {
  sku: string;
  name: string;
  author: string;
  category: string;
  price_inr: number;
  effective_price_inr: number;
  discount_pct: number;
  inventory: number;
};

export type CatalogSnapshot = {
  fetchedAt: string;
  dayIndex: number;
  rows: CatalogRow[];
  byKey: Map<string, CatalogRow>;
};

export type PolicySummary = {
  buyer_max_qty_per_line: number;
  buyer_max_order_total_inr: number;
};

export class HttpError extends Error {
  constructor(public status: number, public body: string, msg: string) {
    super(msg);
  }
}

export async function httpJson<T>(method: 'GET' | 'POST', path: string, body?: unknown, base = DEFAULT_BASE): Promise<T> {
  const url = `${base.replace(/\/$/, '')}${path}`;
  const agentKey = process.env.AGENT_BUYER_KEY || 'demo-agent-key';
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': agentKey,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, `${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(res.status, text, `${method} ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export async function getDayIndex(): Promise<number> {
  const r = await httpJson<{ dayIndex: number }>('GET', '/api/sim/state');
  return r.dayIndex ?? 0;
}

export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const r = await httpJson<{ books: CatalogRow[]; policy_summary: PolicySummary }>('GET', '/api/catalog');
  const byKey = new Map<string, CatalogRow>();
  for (const row of r.books ?? []) byKey.set(row.sku, row);
  return {
    fetchedAt: new Date().toISOString(),
    dayIndex: await getDayIndex(),
    rows: r.books ?? [],
    byKey,
  };
}

export type Diff = {
  sku: string;
  name: string;
  before: { price_inr: number; effective_price_inr: number; discount_pct: number; inventory: number };
  after: { price_inr: number; effective_price_inr: number; discount_pct: number; inventory: number };
  changes: string[];
};

export function diffRow(before: CatalogRow, after: CatalogRow): Diff {
  const changes: string[] = [];
  if (before.discount_pct !== after.discount_pct) {
    changes.push(`discount: ${before.discount_pct}% → ${after.discount_pct}%`);
  }
  if (before.effective_price_inr !== after.effective_price_inr) {
    changes.push(`effective: ₹${before.effective_price_inr} → ₹${after.effective_price_inr}`);
  }
  if (before.inventory !== after.inventory) {
    changes.push(`inventory: ${before.inventory} → ${after.inventory}`);
  }
  return {
    sku: after.sku,
    name: after.name,
    before: {
      price_inr: before.price_inr,
      effective_price_inr: before.effective_price_inr,
      discount_pct: before.discount_pct,
      inventory: before.inventory,
    },
    after: {
      price_inr: after.price_inr,
      effective_price_inr: after.effective_price_inr,
      discount_pct: after.discount_pct,
      inventory: after.inventory,
    },
    changes,
  };
}

export function printSnapshot(label: string, snap: CatalogSnapshot, opts: { onlyDiscounted?: boolean } = {}): void {
  console.log(`\n── ${label} (day ${snap.dayIndex}, ${snap.fetchedAt}) ──`);
  let rows = snap.rows;
  if (opts.onlyDiscounted) rows = rows.filter((r) => r.discount_pct > 0);
  for (const r of rows) {
    const strike = r.discount_pct > 0 ? ` ~~₹${r.price_inr}~~` : '';
    const badge = r.discount_pct > 0 ? `  -${r.discount_pct}%` : '';
    console.log(`  ${r.sku.padEnd(7)} ₹${r.effective_price_inr}${strike}${badge}  (inv ${r.inventory})  ${r.name}`);
  }
}

export function printDiff(diff: Diff): void {
  if (diff.changes.length === 0) {
    console.log(`  ${diff.sku.padEnd(7)} ${diff.name}  (unchanged)`);
    return;
  }
  const tag = diff.after.discount_pct > 0 ? '🟢 CHANGED' : '⚪ changed';
  console.log(`  ${tag}  ${diff.sku}  ${diff.name}`);
  console.log(`            effective ₹${diff.before.effective_price_inr} → ₹${diff.after.effective_price_inr}`);
  for (const c of diff.changes) console.log(`            • ${c}`);
}

export function diffSnapshots(before: CatalogSnapshot, after: CatalogSnapshot): Diff[] {
  const out: Diff[] = [];
  for (const rowAfter of after.rows) {
    const rowBefore = before.byKey.get(rowAfter.sku);
    if (!rowBefore) continue;
    const d = diffRow(rowBefore, rowAfter);
    if (d.changes.length > 0) out.push(d);
  }
  return out;
}

export function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
