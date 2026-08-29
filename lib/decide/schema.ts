/**
 * lib/decide/schema.ts — propose_action tool schema and proposal validator (T-40).
 * Matches AGENT.md §4.4 verbatim.
 */

import type { Proposal } from '@/lib/policy/types';

export const PROPOSE_ACTION_TOOL = {
  name: 'propose_action',
  description: 'Propose exactly one merchandising action for the merchant, or no_action.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['discount', 'feature', 'discount_and_feature', 'no_action'],
        description: 'The proposed action.',
      },
      sku: {
        type: 'string',
        description: 'Required unless action is no_action. Must exist in the catalog.',
      },
      discount_pct: {
        type: 'integer',
        minimum: 1,
        maximum: 90,
        description: 'Required for discount / discount_and_feature.',
      },
      featured_rank: {
        type: 'integer',
        minimum: 1,
        maximum: 8,
        description: 'Required for feature / discount_and_feature. 1 is the leftmost slot.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Your own confidence that this action is right for this signal.',
      },
      justification: {
        type: 'string',
        maxLength: 500,
        description: 'One or two sentences citing the signal\'s actual numbers.',
      },
      trend_match: {
        type: 'object',
        description: 'Required when the signal is trending_headlines.',
        properties: {
          headline: { type: 'string' },
          why_it_matches: { type: 'string', maxLength: 300 },
        },
        required: ['headline', 'why_it_matches'],
      },
    },
    required: ['action', 'confidence', 'justification'],
  },
};

export interface RawToolInput {
  action?: string;
  sku?: string;
  discount_pct?: number;
  featured_rank?: number;
  confidence?: number;
  justification?: string;
  trend_match?: {
    headline?: string;
    why_it_matches?: string;
  };
}

export type ValidationResult =
  | { valid: true; proposal: Proposal }
  | { valid: false; error: string };

/**
 * Validates raw model output against structural and conditional rules (FR-15).
 */
export function validateProposalInput(
  raw: unknown,
  signalKind: 'conversion_drop' | 'dead_stock' | 'trending_headlines',
  catalogSkus?: Set<string>,
): ValidationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, error: 'Model tool call output must be a non-null object' };
  }

  const obj = raw as RawToolInput;

  if (!obj.action || !['discount', 'feature', 'discount_and_feature', 'no_action'].includes(obj.action)) {
    return { valid: false, error: `Invalid action "${obj.action}"` };
  }

  if (typeof obj.confidence !== 'number' || isNaN(obj.confidence) || obj.confidence < 0 || obj.confidence > 1) {
    return { valid: false, error: `Invalid confidence "${obj.confidence}", must be a number between 0 and 1` };
  }

  if (!obj.justification || typeof obj.justification !== 'string' || obj.justification.trim().length === 0) {
    return { valid: false, error: 'Justification is required and must be a non-empty string' };
  }

  const action = obj.action as Proposal['action'];

  if (action === 'no_action') {
    const proposal: Proposal = {
      action: 'no_action',
      confidence: obj.confidence,
      justification: obj.justification.trim(),
    };
    return { valid: true, proposal };
  }

  // Action is not no_action: SKU is required
  if (!obj.sku || typeof obj.sku !== 'string' || obj.sku.trim().length === 0) {
    return { valid: false, error: `SKU is required for action "${action}"` };
  }

  const sku = obj.sku.trim();
  if (catalogSkus && catalogSkus.size > 0 && !catalogSkus.has(sku)) {
    return { valid: false, error: `Proposed SKU "${sku}" does not exist in catalog` };
  }

  // Discount rules
  if (action === 'discount' || action === 'discount_and_feature') {
    if (typeof obj.discount_pct !== 'number' || !Number.isInteger(obj.discount_pct) || obj.discount_pct < 1 || obj.discount_pct > 90) {
      return { valid: false, error: `discount_pct is required for action "${action}" and must be an integer between 1 and 90` };
    }
  }

  // Feature rules
  if (action === 'feature' || action === 'discount_and_feature') {
    if (typeof obj.featured_rank !== 'number' || !Number.isInteger(obj.featured_rank) || obj.featured_rank < 1 || obj.featured_rank > 8) {
      return { valid: false, error: `featured_rank is required for action "${action}" and must be an integer between 1 and 8` };
    }
  }

  // Trend match rules for external signal
  if (signalKind === 'trending_headlines') {
    if (!obj.trend_match || typeof obj.trend_match !== 'object') {
      return { valid: false, error: 'trend_match is required for trending_headlines signal' };
    }
    const tm = obj.trend_match;
    if (!tm.headline || typeof tm.headline !== 'string' || tm.headline.trim().length === 0) {
      return { valid: false, error: 'trend_match.headline is required' };
    }
    if (!tm.why_it_matches || typeof tm.why_it_matches !== 'string' || tm.why_it_matches.trim().length === 0) {
      return { valid: false, error: 'trend_match.why_it_matches is required' };
    }
  }

  const proposal: Proposal = {
    action,
    sku,
    confidence: obj.confidence,
    justification: obj.justification.trim(),
    ...(obj.discount_pct !== undefined ? { discount_pct: obj.discount_pct } : {}),
    ...(obj.featured_rank !== undefined ? { featured_rank: obj.featured_rank } : {}),
    ...(obj.trend_match ? {
      trend_match: {
        headline: obj.trend_match.headline!.trim(),
        why_it_matches: obj.trend_match.why_it_matches!.trim(),
      }
    } : {}),
  };

  return { valid: true, proposal };
}
