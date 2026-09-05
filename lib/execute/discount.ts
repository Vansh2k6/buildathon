/**
 * lib/execute/discount.ts — Execute discount action with transactional ordering (T-61).
 * Ordering rule: Razorpay first, local write second (RULES.md ERR-4).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { serverAdmin } from '@/lib/db';
import { effectivePriceP } from '@/lib/money';
import { createRazorpayPaymentLink, RazorpayApiError } from './razorpay';
import type { ApprovedAction } from '@/lib/policy/types';

export interface DiscountExecutionResult {
  sku: string;
  discount_pct: number;
  old_price_p: number;
  new_price_p: number;
  razorpay_ref_kind: 'payment_link' | 'local_only';
  razorpay_id?: string;
  degraded: boolean;
  error?: string;
}

export async function executeDiscount(
  approved: ApprovedAction,
  runId: string,
  currentDay: number,
  opts?: {
    db?: SupabaseClient;
    forceRazorpayFailure?: boolean;
  },
): Promise<DiscountExecutionResult> {
  const db = opts?.db ?? serverAdmin();
  if (approved.kind !== 'discount' && approved.kind !== 'discount_and_feature') {
    throw new Error('Approved action is not a discount action');
  }
  const sku = approved.sku;
  const discountPct = approved.discount_pct;

  // 1. Fetch product row
  const { data: product, error: pErr } = await db
    .from('products')
    .select('id, price_p')
    .eq('sku', sku)
    .single();

  if (pErr || !product) {
    throw new Error(`Product "${sku}" not found in database: ${pErr?.message}`);
  }

  const oldPriceP = product.price_p;
  const newPriceP = effectivePriceP(oldPriceP, discountPct);

  // Expire any currently active discount for this product first
  await db
    .from('discounts')
    .update({ status: 'expired' })
    .eq('product_id', product.id)
    .eq('status', 'active');

  // 2. Razorpay FIRST (RULES.md ERR-4)
  let razorpayId: string | undefined = undefined;
  let refKind: 'payment_link' | 'local_only' = 'payment_link';
  let degraded = false;
  let razorpayError: string | undefined = undefined;

  if (opts?.forceRazorpayFailure) {
    degraded = true;
    refKind = 'local_only';
    razorpayError = 'Forced Razorpay API failure for testing';
  } else {
    try {
      const plink = await createRazorpayPaymentLink({
        amount_p: newPriceP,
        description: `Discount ${discountPct}% for ${sku}`,
        reference_id: `disc-${runId.slice(0, 8)}-${Date.now()}`,
      });
      razorpayId = plink.id;
    } catch (err: any) {
      degraded = true;
      refKind = 'local_only';
      razorpayError = err instanceof Error ? err.message : String(err);
    }
  }

  // 3. Local write SECOND
  try {
    const { error: dErr } = await db.from('discounts').insert({
      product_id: product.id,
      pct: discountPct,
      status: 'active',
      run_id: runId,
      razorpay_offer_id: razorpayId ?? null,
      razorpay_ref_kind: refKind,
      created_day_index: currentDay,
    });

    if (dErr) {
      throw new Error(`DB insert discount failed: ${dErr.message}`);
    }
  } catch (err: any) {
    // If Razorpay succeeded but local write failed -> log orphaned payment link
    if (razorpayId) {
      console.warn(`[level='warn'] Orphaned Razorpay Payment Link ${razorpayId} created but local DB write failed: ${err.message}`);
    }
    return {
      sku,
      discount_pct: discountPct,
      old_price_p: oldPriceP,
      new_price_p: newPriceP,
      razorpay_ref_kind: refKind,
      razorpay_id: razorpayId,
      degraded: true,
      error: `Local DB write failure: ${err.message}`,
    };
  }

  return {
    sku,
    discount_pct: discountPct,
    old_price_p: oldPriceP,
    new_price_p: newPriceP,
    razorpay_ref_kind: refKind,
    razorpay_id: razorpayId,
    degraded,
    error: razorpayError,
  };
}
