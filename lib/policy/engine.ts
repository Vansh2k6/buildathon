/**
 * lib/policy/engine.ts — evaluate(proposal, policy, facts) → Verdict (T-22).
 *
 * Runs the §5.1 rules in order and returns on the FIRST violation, so the
 * audit names one cause (NFR-7). Pure code: no imports from decide/, no
 * network, no Supabase. The ApprovedAction is built here — a raw Proposal
 * never reaches execute (AGENT.md §5.5).
 */
import { AGENT_RULES } from './rules';
import { approve, type AgentWorldFacts, type ApprovedAction, type MerchantPolicyLimits, type Proposal, type RuleId, type Verdict } from './types';

export function evaluate(proposal: Proposal, policy: MerchantPolicyLimits, facts: AgentWorldFacts): Verdict {
  const checked: RuleId[] = [];

  for (const rule of AGENT_RULES) {
    if (!rule.applies(proposal, facts)) continue;
    const failure = rule.check(proposal, policy, facts);
    if (failure) {
      return {
        ok: false,
        rule: rule.id,
        message: failure.message,
        detail: { value: failure.value, limit: failure.limit, sku: failure.sku ?? proposal.sku },
      };
    }
    checked.push(rule.id);
  }

  let approvedAction: ApprovedAction;
  if (proposal.action === 'no_action') {
    approvedAction = approve({ kind: 'no_action' });
  } else if (proposal.action === 'discount') {
    approvedAction = approve({ kind: 'discount', sku: proposal.sku as string, discount_pct: proposal.discount_pct as number });
  } else if (proposal.action === 'feature') {
    approvedAction = approve({ kind: 'feature', sku: proposal.sku as string, featured_rank: proposal.featured_rank as number });
  } else {
    approvedAction = approve({
      kind: 'discount_and_feature',
      sku: proposal.sku as string,
      discount_pct: proposal.discount_pct as number,
      featured_rank: proposal.featured_rank as number,
    });
  }

  return { ok: true, approvedAction, checked };
}
