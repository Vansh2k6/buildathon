/**
 * lib/execute/featured.ts — Execute featured placement action (T-62).
 * DB-only merchandising rank change.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { serverAdmin } from '@/lib/db';
import type { ApprovedAction } from '@/lib/policy/types';

export interface FeaturedExecutionResult {
  sku: string;
  featured_rank: number;
}

export async function executeFeatured(
  approved: ApprovedAction,
  opts?: { db?: SupabaseClient },
): Promise<FeaturedExecutionResult> {
  const db = opts?.db ?? serverAdmin();
  if (approved.kind !== 'feature' && approved.kind !== 'discount_and_feature') {
    throw new Error('Approved action is not a feature action');
  }
  const sku = approved.sku;
  const rank = approved.featured_rank ?? 1;

  if (!sku) {
    throw new Error('Approved featured action must specify sku');
  }

  // If setting as primary hero (rank 1), un-feature previous hero book(s)
  if (rank === 1) {
    await db
      .from('products')
      .update({
        is_featured: false,
        featured_rank: null,
      })
      .neq('sku', sku)
      .eq('featured_rank', 1);
  }

  const { error } = await db
    .from('products')
    .update({
      is_featured: true,
      featured_rank: rank,
    })
    .eq('sku', sku);

  if (error) {
    throw new Error(`Failed to update featured rank for ${sku}: ${error.message}`);
  }

  return {
    sku,
    featured_rank: rank,
  };
}
