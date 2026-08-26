/**
 * verify-phase1.ts — Phase 1 exit criteria, checked against the LIVE database.
 * Run: npx tsx scripts/verify-phase1.ts
 *
 * Covers (PHASES.md §4):
 *   · seed present: 10 books, two-title featured baseline
 *   · reset idempotent and restores day 0 EXACTLY (incl. play-state columns)
 *   · advance 0 → 8 yields exactly ONE conversion drop, on BK-101
 *   · anon can read public tables but CANNOT write anywhere (RLS / NFR-4)
 * Self-cleaning: ends with demo_reset() so state is pristine day 0.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from './_env.ts';

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !service || !anonKey) throw new Error('Missing Supabase env in .env.local');

const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });
const anon: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false } });

const results: Array<{ name: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string): boolean {
  results.push({ name, pass, detail });
  return pass;
}

async function resetOnce(): Promise<void> {
  const { error } = await admin.rpc('demo_reset');
  if (error) throw new Error(`demo_reset failed: ${error.message}`);
}

async function main(): Promise<void> {
  // ── 1. seed present ────────────────────────────────────────────────
  const { data: books, error: e1 } = await admin.from('products').select('*').order('sku');
  if (e1) throw new Error(e1.message);
  check('catalog has 10 books', books!.length === 10, `found ${books!.length}`);

  const featured = books!.filter((b) => b.is_featured);
  check(
    'featured baseline is exactly two titles ranked 1,2',
    featured.length === 2 && featured.every((b) => b.featured_rank === 1 || b.featured_rank === 2),
    JSON.stringify(featured.map((f) => f.sku)),
  );

  const bk101 = books!.find((b) => b.sku === 'BK-101');
  check(
    'BK-101 fixture intact (₹499/₹300/42)',
    !!bk101 && bk101.price_p === 49900 && bk101.cost_p === 30000 && bk101.inventory === 42,
  );

  // ── 2. reset idempotence + play-state restore ─────────────────────
  await resetOnce();
  // dirty the world the way later phases would: feature a title, wreck inventory
  const { error: dirtyErr } = await admin
    .from('products')
    .update({ is_featured: true, featured_rank: 9, inventory: 99 })
    .eq('sku', 'BK-109');
  if (dirtyErr) throw new Error(dirtyErr.message);
  await resetOnce();

  const { data: afterReset } = await admin.from('products').select('*').eq('sku', 'BK-109').single();
  const mug = afterReset!;
  check(
    'reset restores play-state (is_featured/rank/inventory)',
    mug.is_featured === false && mug.featured_rank === null && mug.inventory === 48,
    JSON.stringify({ is_featured: mug.is_featured, featured_rank: mug.featured_rank, inventory: mug.inventory }),
  );

  const { count: metricCount, error: mcErr } = await admin
    .from('product_metrics_daily')
    .select('*', { count: 'exact', head: true });
  if (mcErr) throw new Error(mcErr.message);
  check('metrics reseeded to 80 rows (10 books × 8 days)', metricCount === 80, `count=${metricCount}`);

  // run reset twice more — identical outcome is the AC-3 property
  const snapA = (await admin.from('products').select('sku,is_featured,featured_rank,inventory')).data;
  await resetOnce();
  const snapB = (await admin.from('products').select('sku,is_featured,featured_rank,inventory')).data;
  check('reset is idempotent across runs', JSON.stringify(snapA) === JSON.stringify(snapB));

  // ── 3. advance to day 8 → exactly one conversion drop ─────────────
  for (let i = 0; i < 8; i++) {
    const { data, error } = await admin.rpc('demo_advance_day');
    if (error) throw new Error(`advance failed: ${error.message}`);
    var dayIndex = data as number;
  }
  check('advanced 0 → 8', dayIndex === 8, `dayIndex=${dayIndex}`);

  const { data: metrics, error: mErr } = await admin.from('product_metrics_daily').select('*');
  if (mErr) throw new Error(mErr.message);
  type M = { product_id: string; day_index: number; views: number; orders: number };
  const byProduct = new Map<string, M[]>();
  for (const m of metrics as unknown as M[]) {
    const list = byProduct.get(m.product_id) ?? [];
    list.push(m);
    byProduct.set(m.product_id, list);
  }
  const skuById = new Map(books!.map((b) => [b.id, b.sku]));
  let fired = 0;
  const firedSkus: string[] = [];
  for (const [pid, rows] of byProduct) {
    const d8 = rows.find((r) => r.day_index === 8)!;
    const base = rows.filter((r) => r.day_index <= 7);
    const baseCR = base.reduce((s, r) => s + r.orders / Math.max(r.views, 1), 0) / base.length;
    const cr8 = d8.orders / Math.max(d8.views, 1);
    const dropRel = baseCR > 0 ? ((baseCR - cr8) / baseCR) * 100 : 0;
    if (dropRel >= 30 && d8.views >= 50) {
      fired++;
      firedSkus.push(`${skuById.get(pid)} (${dropRel.toFixed(1)}%)`);
    }
  }
  check('exactly ONE conversion drop fires', fired === 1, `fires=[${firedSkus.join(', ')}]`);
  check('the drop is on BK-101', firedSkus.some((s) => s.startsWith('BK-101')), firedSkus.join(', '));

  // ── 4. RLS: anon reads allowed where intended, writes denied everywhere ──
  const { data: anonBooks, error: anonReadErr } = await anon.from('products').select('sku');
  check(
    'anon CAN read products',
    !anonReadErr && (anonBooks?.length ?? 0) === 10,
    anonReadErr?.message ?? `${anonBooks?.length} rows`,
  );

  const { data: simForAnon, error: simErr } = await anon.from('sim_state').select('*');
  check(
    'anon CANNOT read sim_state (no policy → empty)',
    !simErr && (simForAnon?.length ?? 1) === 0,
    simErr ? `err:${simErr.message}` : `${simForAnon?.length} rows`,
  );

  const { error: writeErr } = await anon
    .from('products')
    .insert({ sku: 'RLS-PROBE', name: 'x', description: 'x', author: '', category: 'x', price_p: 1, cost_p: 0 });
  const denied = !!writeErr && /row-level security/i.test(writeErr.message);
  check('anon write DENIED by RLS', denied, writeErr?.message ?? 'INSERT SUCCEEDED — RLS GAP');
  if (!denied) {
    // never leave probe junk behind if policies are broken
    await admin.from('products').delete().eq('sku', 'RLS-PROBE');
  }

  // ── cleanup: pristine day 0 ────────────────────────────────────────
  await resetOnce();
  const { data: finalState } = await admin.from('sim_state').select('current_day_index').single();
  check('final state is pristine day 0', finalState?.current_day_index === 0);

  // ── report ─────────────────────────────────────────────────────────
  console.log('\n══ Phase 1 verification ══');
  let allPass = true;
  for (const r of results) {
    console.log(` ${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
    allPass &&= r.pass;
  }
  console.log(allPass ? '\nALL CHECKS PASS' : '\nFAILURES PRESENT');
  process.exit(allPass ? 0 : 3);
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
