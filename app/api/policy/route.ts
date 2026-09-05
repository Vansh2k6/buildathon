import { NextRequest, NextResponse } from 'next/server';
import { serverAdmin } from '@/lib/db';
import { DEFAULT_POLICY_LIMITS } from '@/lib/policy/rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Valid categories whitelist for SQL-injection proof sanitization
const VALID_CATEGORIES = new Set([
  'fiction',
  'travel',
  'wellness',
  'sports',
  'thriller',
  'gift',
  'nature',
  'stationery',
  'poetry',
]);

/**
 * Validates and sanitizes integer within safe bounds.
 */
function validateInteger(val: any, fieldName: string, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isInteger(val)) {
    throw new Error(`Field '${fieldName}' must be a valid integer`);
  }
  if (val < min || val > max) {
    throw new Error(`Field '${fieldName}' must be between ${min} and ${max}`);
  }
  return val;
}

/**
 * Validates array of category strings.
 */
function validateCategories(val: any): string[] {
  if (!Array.isArray(val)) {
    throw new Error("Field 'blocked_categories' must be an array of category strings");
  }
  const sanitized: string[] = [];
  for (const item of val) {
    if (typeof item !== 'string') {
      throw new Error("Category items must be strings");
    }
    const clean = item.trim().toLowerCase();
    if (clean && VALID_CATEGORIES.has(clean)) {
      sanitized.push(clean);
    }
  }
  return Array.from(new Set(sanitized));
}

/**
 * GET /api/policy — Fetch current merchant policy from DB.
 */
export async function GET() {
  try {
    const db = serverAdmin();
    const { data, error } = await db
      .from('merchant_policy')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? DEFAULT_POLICY_LIMITS);
  } catch (err: any) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch policy' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/policy — Securely update merchant safety thresholds.
 * Uses parameterized queries via Supabase client to guarantee SQL injection safety.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Strict sanitization & range validation
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if ('max_discount_pct' in body) {
      updates.max_discount_pct = validateInteger(body.max_discount_pct, 'max_discount_pct', 1, 90);
    }
    if ('min_margin_pct' in body) {
      updates.min_margin_pct = validateInteger(body.min_margin_pct, 'min_margin_pct', 0, 100);
    }
    if ('max_active_discounts' in body) {
      updates.max_active_discounts = validateInteger(body.max_active_discounts, 'max_active_discounts', 1, 50);
    }
    if ('max_actions_per_day' in body) {
      updates.max_actions_per_day = validateInteger(body.max_actions_per_day, 'max_actions_per_day', 1, 50);
    }
    if ('daily_discount_budget_p' in body) {
      updates.daily_discount_budget_p = validateInteger(body.daily_discount_budget_p, 'daily_discount_budget_p', 0, 100_000_000);
    }
    if ('max_featured_slots' in body) {
      updates.max_featured_slots = validateInteger(body.max_featured_slots, 'max_featured_slots', 1, 20);
    }
    if ('cooldown_days' in body) {
      updates.cooldown_days = validateInteger(body.cooldown_days, 'cooldown_days', 0, 30);
    }
    if ('buyer_max_order_p' in body) {
      updates.buyer_max_order_p = validateInteger(body.buyer_max_order_p, 'buyer_max_order_p', 0, 100_000_000);
    }
    if ('buyer_max_qty_per_sku' in body) {
      updates.buyer_max_qty_per_sku = validateInteger(body.buyer_max_qty_per_sku, 'buyer_max_qty_per_sku', 1, 100);
    }
    if ('blocked_categories' in body) {
      updates.blocked_categories = validateCategories(body.blocked_categories);
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'No valid policy fields provided to update' }, { status: 400 });
    }

    const db = serverAdmin();
    const { data, error } = await db
      .from('merchant_policy')
      .update(updates)
      .eq('id', 1)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, policy: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update policy' },
      { status: 400 }
    );
  }
}
