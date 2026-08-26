/**
 * T-02 — Razorpay representation-tier probe (test mode).
 *
 * ══════════════════════════════════════════════════════════════════
 * TIER ANSWER — probed live 2026-08-26 · GATE G0: RESOLVED
 *   POST /v1/orders          : ✓ available (order_TU8E0EINggeQU2 created)
 *   POST /v1/payment_links   : ✓ available (plink_TU8E0gJQ84hVfl + short_url)
 *   GET  /v1/offers          : ✗ HTTP 400 "Request Validation Failure"
 *                              (moot — see create result)
 *   POST /v1/offers (create) : ✗ HTTP 405 Method Not Allowed.
 *                              Programmatic offer creation DOES NOT EXIST;
 *                              docs confirm offers are Dashboard-created only.
 *   => razorpay_ref_kind ladder (ADR-009), resolved:
 *        'offer'         — DEAD (no programmatic creation)
 *        'payment_link'  — PRIMARY (live-verified in test mode)
 *        'local_only'    — fallback as designed
 *   ADR-009 status flips: "verification pending" → VERIFIED.
 * ══════════════════════════════════════════════════════════════════
 */
import { loadEnv, requireKey } from './_env.ts';

loadEnv();
const ID = requireKey('RAZORPAY_KEY_ID');
const SECRET = requireKey('RAZORPAY_KEY_SECRET');
const AUTH = Buffer.from(`${ID}:${SECRET}`).toString('base64');
const BASE = 'https://api.razorpay.com/v1';

interface ProbeResult { label: string; ok: boolean; detail: string }

async function call(label: string, method: string, path: string, body?: unknown): Promise<ProbeResult> {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let summary = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      if (res.ok) {
        const id = typeof j.id === 'string' ? j.id : '(no id)';
        summary += ` id=${id}`;
        if (typeof j.status === 'string') summary += ` status=${j.status}`;
        if (typeof j.short_url === 'string') summary += ` short_url=yes`;
        if (Array.isArray(j.items)) summary += ` items=${j.items.length}`;
      } else {
        const err = (j.error ?? {}) as { description?: string; reason?: string };
        summary += ` error=${err.description ?? err.reason ?? text.slice(0, 160)}`;
      }
    } catch {
      summary += ` body=${text.slice(0, 120)}`;
    }
    return { label, ok: res.ok, detail: summary };
  } catch (e) {
    return { label, ok: false, detail: `NETWORK FAIL: ${(e as Error).message}` };
  }
}

async function main(): Promise<void> {
  // 0. Key-pair sanity check first.
  const auth = await call('auth check (GET /payments)', 'GET', '/payments?count=1');
  console.log(`${auth.label}: ${auth.detail}\n`);
  if (!auth.ok && auth.detail.includes('401')) {
    console.error('FATAL: key pair rejected — fix RAZORPAY_KEY_ID/SECRET before probing.');
    process.exit(1);
  }

  const results: ProbeResult[] = [
    auth,
    await call('POST /v1/orders', 'POST', '/orders', {
      amount: 10_000, currency: 'INR', receipt: `smoke-${Date.now()}`,
    }),
    await call('POST /v1/payment_links', 'POST', '/payment_links', {
      amount: 10_000, currency: 'INR',
    }),
    await call('GET /v1/offers', 'GET', '/offers?count=5'),
    // Deliberate minimal attempt: does programmatic offer creation exist at all?
    await call('POST /v1/offers (create attempt)', 'POST', '/offers', { type: 'instant' }),
  ];

  console.log('\n══ PROBE SUMMARY ══');
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}: ${r.detail}`);
  console.log('\n→ Now write the TIER ANSWER into this script\'s header comment (gate G0).');
}

main().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
