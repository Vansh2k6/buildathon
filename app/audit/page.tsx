import { serverAdmin } from '@/lib/db';
import { renderRunNarrative } from '@/lib/audit/narrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AgentRunRow {
  id: string;
  trigger: string;
  day_index: number;
  status: string;
  signal: any;
  proposal: any;
  proposal_retry: any;
  verdict: any;
  execution: any;
  narrative: string;
  started_at: string;
  finished_at: string;
}

interface AgentEventRow {
  id: number;
  run_id: string;
  seq: number;
  phase: string;
  level: string;
  message: string;
  payload: any;
  created_at: string;
}

async function getRunsWithEvents() {
  const db = serverAdmin();
  const { data: runs, error: rErr } = await db
    .from('agent_runs')
    .select('*')
    .order('started_at', { ascending: false });

  if (rErr || !runs) return [];

  const { data: events, error: eErr } = await db
    .from('agent_events')
    .select('*')
    .order('seq', { ascending: true });

  const eventsByRun = new Map<string, AgentEventRow[]>();
  for (const ev of (events ?? []) as AgentEventRow[]) {
    const list = eventsByRun.get(ev.run_id) ?? [];
    list.push(ev);
    eventsByRun.set(ev.run_id, list);
  }

  return runs.map((run: AgentRunRow) => ({
    ...run,
    events: eventsByRun.get(run.id) ?? [],
  }));
}

export default async function AuditPage() {
  const runs = await getRunsWithEvents();

  return (
    <main className="container">
      <h1 className="page-title">Audit Trail & Bounded Autonomy Logs</h1>
      <p className="page-sub">
        Every agent observation, LLM proposal, policy decision, and execution step — logged immutably.
      </p>

      {runs.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '48px' }}>
          <p className="page-sub" style={{ margin: 0 }}>
            No agent cycles recorded yet. Go to the <strong>Control Panel</strong> or run a cycle to generate logs.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {runs.map((run) => {
            const isRejected = run.status === 'rejected' || run.verdict?.ok === false;
            const isExecuted = run.status === 'executed';
            const story = run.narrative || renderRunNarrative((run.events || []) as any);

            return (
              <div key={run.id} className="glass-card" style={{ position: 'relative' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`badge-status badge-${run.status}`}>
                      {run.status}
                    </span>
                    <span className="badge-featured" style={{ textTransform: 'uppercase' }}>
                      Trigger: {run.trigger}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Day {run.day_index}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Run ID: {run.id.slice(0, 8)}...
                  </span>
                </div>

                {/* Flagship Rejection Callout Box (Submission Centrepiece) */}
                {isRejected && run.verdict && (() => {
                  // P1a: format value/limit per rule type
                  const rule = run.verdict.rule ?? '';
                  const PCT_RULES = ['MAX_DISCOUNT_PCT', 'MIN_MARGIN_PCT'];
                  const INR_RULES = ['DAILY_DISCOUNT_BUDGET', 'BUYER_MAX_ORDER'];
                  const DAY_RULES = ['COOLDOWN'];

                  const fmt = (v: any) => {
                    if (v === undefined || v === null) return '—';
                    if (PCT_RULES.includes(rule)) return `${v}%`;
                    if (INR_RULES.includes(rule)) return `₹${(Number(v) / 100).toLocaleString('en-IN')}`;
                    if (DAY_RULES.includes(rule)) return `${v}d`;
                    return String(v);
                  };

                  return (
                  <div className="rejection-banner">
                    <div className="rejection-header">
                      <div className="rejection-title">
                        <span>Policy check held the line</span>
                      </div>
                      <span className="badge-status badge-blocked">
                        RULE: {rule}
                      </span>
                    </div>

                    <p style={{ fontSize: '0.95rem', color: 'var(--text-primary)', margin: '8px 0' }}>
                      {run.verdict.message || 'Proposal exceeded merchant safety policy.'}
                    </p>

                    <div className="rejection-comparison">
                      <div>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>PROPOSED BY LLM:</span>
                        <div style={{ color: 'var(--orange)', fontWeight: '600', fontSize: '1.1rem' }}>
                          {run.verdict.detail?.value !== undefined ? fmt(run.verdict.detail.value) : 'Off-policy'}
                        </div>
                      </div>
                      <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '24px' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>MERCHANT POLICY CEILING:</span>
                        <div style={{ color: 'var(--accent)', fontWeight: '600', fontSize: '1.1rem' }}>
                          {run.verdict.detail?.limit !== undefined ? fmt(run.verdict.detail.limit) : 'Ceiling Enforced'}
                        </div>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '12px', fontStyle: 'italic' }}>
                      Bounded autonomy: the model was never disclosed the policy ceiling in its prompt. Deterministic code enforced the limit and refused the action.
                    </p>
                  </div>
                  );
                })()}

                {/* Retry Turn Block */}
                {run.proposal_retry && (
                  <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', margin: '16px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span className="badge-status badge-retry">RETRY TURN (1 of 1)</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--orange)' }}>
                        Model re-proposed after feedback
                      </span>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0 }}>
                      Proposed updated discount: <strong>{run.proposal_retry.discount_pct}%</strong> on SKU {run.proposal_retry.sku}
                    </p>
                  </div>
                )}

                {/* Human Narrative Story */}
                <div style={{ background: 'var(--bg-card-hover)', borderRadius: '8px', padding: '16px', marginTop: '16px' }}>
                  <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                    Execution Narrative
                  </h4>
                  <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                    {story}
                  </pre>
                </div>

                {/* Event Log Stream Accordion */}
                <details style={{ marginTop: '16px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Inspect Raw Event Sequence ({run.events.length} events)
                  </summary>
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {run.events.map((ev) => (
                      <div key={ev.id} style={{ background: 'var(--green-50)', padding: '10px 14px', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ display: 'flex', gap: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                          <span>Seq #{ev.seq}</span>
                          <span style={{ color: 'var(--blue)' }}>[{ev.phase.toUpperCase()}]</span>
                          <span>{ev.level.toUpperCase()}</span>
                        </div>
                        <div style={{ color: 'var(--text-primary)' }}>{ev.message}</div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
