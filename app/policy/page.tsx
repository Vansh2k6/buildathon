import { serverAdmin } from '@/lib/db';
import { DEFAULT_POLICY_LIMITS } from '@/lib/policy/rules';
import { PolicyClient } from './PolicyClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getMerchantPolicy() {
  const db = serverAdmin();
  const { data } = await db.from('merchant_policy').select('*').eq('id', 1).single();
  return data ?? DEFAULT_POLICY_LIMITS;
}

export default async function PolicyPage() {
  const policy = await getMerchantPolicy();

  return (
    <main className="container">
      <div style={{ marginBottom: '28px' }}>
        <h1 className="page-title">Merchant Safety Policy Engine</h1>
        <p className="page-sub">
          The merchant-owned rule row in Supabase (<code>merchant_policy</code>). Inspect active invariants or fine-tune safety thresholds in real-time.
        </p>
      </div>

      <PolicyClient initialPolicy={policy} />
    </main>
  );
}
