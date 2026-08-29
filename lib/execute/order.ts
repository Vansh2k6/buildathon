/**
 * lib/execute/order.ts — AI-buyer order execution with Razorpay artifacts (T-63).
 * Returns real test-mode short_url and writes orders row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { serverAdmin } from '@/lib/db';
import { createRazorpayOrder, createRazorpayPaymentLink } from './razorpay';
import type { ApprovedAction } from '@/lib/policy/types';

export interface OrderExecutionResult {
  order_id: string;
  razorpay_order_id: string;
  razorpay_payment_link_id: string;
  razorpay_short_url: string;
  total_p: number;
}

export async function executeOrder(
  approved: ApprovedAction,
  runId: string,
  opts?: { db?: SupabaseClient },
): Promise<OrderExecutionResult> {
  const db = opts?.db ?? serverAdmin();

  if (approved.kind !== 'buyer_order' || !approved.lines || approved.total_p === undefined) {
    throw new Error('Approved action must be buyer_order with lines and total_p');
  }

  const receipt = `order-${Date.now()}`;
  const totalP = approved.total_p;
  const buyerRef = approved.buyer_ref ?? 'ai_buyer_agent';

  // 1. Create Razorpay Order
  const rzpOrder = await createRazorpayOrder({
    amount_p: totalP,
    receipt,
    notes: { buyer_ref: buyerRef, run_id: runId },
  });

  // 2. Create Razorpay Payment Link
  const rzpPlink = await createRazorpayPaymentLink({
    amount_p: totalP,
    description: `AI-Buyer Purchase (${approved.lines.length} item(s))`,
    reference_id: `order-${runId.slice(0, 8)}-${Date.now()}`,
  });

  // 3. Insert into orders table
  const { data: orderRow, error: oErr } = await db
    .from('orders')
    .insert({
      source: 'ai_buyer',
      buyer_ref: buyerRef,
      items: approved.lines,
      subtotal_p: totalP,
      discount_p: 0,
      total_p: totalP,
      razorpay_order_id: rzpOrder.id,
      razorpay_payment_link_id: rzpPlink.id,
      razorpay_short_url: rzpPlink.short_url,
      status: 'created',
      run_id: runId,
    })
    .select('id')
    .single();

  if (oErr || !orderRow) {
    throw new Error(`Failed to write orders row: ${oErr?.message}`);
  }

  return {
    order_id: orderRow.id,
    razorpay_order_id: rzpOrder.id,
    razorpay_payment_link_id: rzpPlink.id,
    razorpay_short_url: rzpPlink.short_url,
    total_p: totalP,
  };
}
