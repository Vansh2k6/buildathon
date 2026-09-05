'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function ControlPage() {
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);

  async function refreshDay() {
    try {
      const res = await fetch('/api/sim/state');
      if (res.ok) {
        const data = await res.json();
        setDayIndex(data.dayIndex);
      }
    } catch {
      // ignore state fetch error
    }
  }

  useEffect(() => {
    refreshDay();
  }, []);

  function addLog(msg: string) {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 20)]);
  }

  async function handleAdvanceDay() {
    setLoading(true);
    setActiveAction('advance');
    addLog('Advancing simulated time forward 1 day...');
    try {
      const res = await fetch('/api/sim/advance-day', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setDayIndex(data.dayIndex);
        addLog(`Time advanced to Day ${data.dayIndex}`);
      } else {
        addLog(`Error advancing day: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Failed to advance day: ${e.message}`);
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  async function handleRunCycle(trigger: 'internal' | 'external') {
    setLoading(true);
    setActiveAction(`cycle-${trigger}`);
    addLog(`Triggering ${trigger.toUpperCase()} agent cycle...`);
    try {
      const res = await fetch('/api/sim/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger }),
      });
      const data = await res.json();
      setLastResult(data);
      if (res.ok) {
        addLog(`Cycle completed with status '${data.status}' (Run ID: ${data.runId?.slice(0, 8)})`);
      } else {
        addLog(`Cycle failed: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Cycle request error: ${e.message}`);
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  async function handleReset() {
    if (!confirm('Are you sure you want to reset simulation state back to Day 0?')) return;
    setLoading(true);
    setActiveAction('reset');
    addLog('Resetting simulation state to Day 0...');
    try {
      const res = await fetch('/api/sim/reset', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setDayIndex(0);
        setLastResult(null);
        addLog('Simulation reset to Day 0.');
      } else {
        addLog(`Reset failed: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`Reset error: ${e.message}`);
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <main className="container">
      <h1 className="page-title">Simulation Control Panel</h1>
      <p className="page-sub">
        Operational cockpit to drive time advancement, trigger internal/external cycles, and inspect live agent runs.
      </p>

      {/* Clock Widget */}
      <div className="glass-card" style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            SIMULATED TIME CLOCK
          </span>
          <div style={{ fontSize: '2.5rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginTop: '4px' }}>
            {dayIndex !== null ? `Day ${dayIndex}` : 'Day ...'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            className="btn btn-primary"
            onClick={handleAdvanceDay}
            disabled={loading}
          >
            {activeAction === 'advance' ? 'Advancing...' : ' Advance 1 Day'}
          </button>
        </div>
      </div>

      {/* Trigger Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        <div className="glass-card">
          <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Internal Detector Cycle</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Scans Supabase conversion metrics & dead stock. On Day 8, fires conversion drop signal on BK-101.
          </p>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', borderColor: 'var(--accent)', color: 'var(--accent)' }}
            onClick={() => handleRunCycle('internal')}
            disabled={loading}
          >
            {activeAction === 'cycle-internal' ? 'Running Cycle...' : ' Run Internal Cycle'}
          </button>
        </div>

        <div className="glass-card">
          <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>External Detector Cycle</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Fetches live headlines from NewsAPI.org. Matches trending news keywords to catalog book themes.
          </p>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', borderColor: 'var(--blue)', color: 'var(--blue)' }}
            onClick={() => handleRunCycle('external')}
            disabled={loading}
          >
            {activeAction === 'cycle-external' ? 'Running Cycle...' : ' Run External Cycle'}
          </button>
        </div>

        <div className="glass-card">
          <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Reset Simulation</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Resets simulation to Day 0, clears discounts & agent runs, and restores fixture inventory.
          </p>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }}
            onClick={handleReset}
            disabled={loading}
          >
            {activeAction === 'reset' ? 'Resetting...' : ' Reset to Day 0'}
          </button>
        </div>
      </div>

      {/* Latest Cycle Result Card */}
      {lastResult && (
        <div className="glass-card" style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Latest Cycle Outcome</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span className={`badge-status badge-${lastResult.status}`}>
                {lastResult.status}
              </span>
              <Link href="/audit" className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.8rem' }}>
                View in Audit →
              </Link>
            </div>
          </div>

          {lastResult.narrative && (
            <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-primary)', background: 'var(--green-50)', padding: '16px', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>
              {lastResult.narrative}
            </pre>
          )}
        </div>
      )}

      {/* Real-time Activity Terminal Log */}
      <div className="glass-card">
        <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
          Real-time Activity Log
        </h3>
        <div style={{ background: 'var(--green-900)', padding: '16px', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', minHeight: '120px', color: 'var(--green-100)' }}>
          {logs.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>No activity yet. Click a button above to execute simulation actions.</span>
          ) : (
            logs.map((l, idx) => <div key={idx}>{l}</div>)
          )}
        </div>
      </div>
    </main>
  );
}
