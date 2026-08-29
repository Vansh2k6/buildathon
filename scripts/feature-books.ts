/**
 * feature-books.ts — curate the featured shelf (is_featured + featured_rank).
 *
 * Usage:   npx tsx scripts/feature-books.ts SKU:RANK [SKU:RANK ...]
 *          rank >= 1  → feature at that slot (1 = hero, leftmost)
 *          rank 0     → remove from the shelf
 * Example: npx tsx scripts/feature-books.ts BK-101:1 BK-271:2 BK-102:0
 *
 * Enforces merchant_policy.max_featured_slots before writing — the merchant
 * row outranks the tool the same way it outranks the model.
 * Prints the shelf that results, hero first.
 */
import { loadEnv } from './_env.ts';

loadEnv();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    throw new Error('usage: npx tsx scripts/feature-books.ts SKU:RANK [SKU:RANK ...]  (rank 0 removes)');
  }
  const updates = args.map((arg) => {
    const m = /^([A-Za-z0-9-]+):(\d+)$/.exec(arg);
    if (!m) throw new Error(`bad arg "${arg}" — expected SKU:RANK`);
    return { sku: m[1], rank: Number(m[2]) };
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env in .env.local');
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });

  // The ceiling the policy engine will enforce later — honor it already.
  const { data: policy, error: polErr } = await db
    .from('merchant_policy')
    .select('max_featured_slots')
    .eq('id', 1)
    .single();
  if (polErr) throw new Error(polErr.message);
  const maxSlots = (policy as { max_featured_slots: number }).max_featured_slots;

  // Every SKU named must exist.
  const skus = updates.map((u) => u.sku);
  const { data: named, error: namedErr } = await db
    .from('products')
    .select('sku')
    .in('sku', skus);
  if (namedErr) throw new Error(namedErr.message);
  const found = new Set((named ?? []).map((p) => p.sku));
  for (const u of updates) {
    if (!found.has(u.sku)) throw new Error(`unknown sku: ${u.sku}`);
  }

  // Count featured slots that survive this edit, then check the ceiling.
  const { data: featured, error: featErr } = await db
    .from('products')
    .select('sku')
    .eq('is_featured', true);
  if (featErr) throw new Error(featErr.message);
  const touched = new Set(skus);
  const keeping = (featured ?? []).filter((p) => !touched.has(p.sku)).length;
  const adding = updates.filter((u) => u.rank >= 1).length;
  if (keeping + adding > maxSlots) {
    throw new Error(`policy: max_featured_slots is ${maxSlots}, this edit would feature ${keeping + adding}`);
  }

  for (const { sku, rank } of updates) {
    const patch = { is_featured: rank >= 1, featured_rank: rank >= 1 ? rank : null };
    const { error } = await db.from('products').update(patch).eq('sku', sku);
    if (error) throw new Error(`${sku}: ${error.message}`);
    console.log(`${rank >= 1 ? 'featured' : 'removed '} ${sku} → slot ${rank >= 1 ? rank : '—'}`);
  }

  const { data: shelf, error: shelfErr } = await db
    .from('products')
    .select('sku, name, category, featured_rank')
    .eq('is_featured', true)
    .order('featured_rank', { ascending: true });
  if (shelfErr) throw new Error(shelfErr.message);
  console.log('\nFeatured shelf now:');
  for (const b of (shelf ?? []) as Array<{ sku: string; name: string; category: string; featured_rank: number }>) {
    console.log(`  ${b.featured_rank}. [${b.category}] ${b.name} (${b.sku})`);
  }
}

main().catch((e) => {
  console.error('FEATURE FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
