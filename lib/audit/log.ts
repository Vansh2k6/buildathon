/**
 * lib/audit/log.ts — Structured DB audit writer for agent runs and events (T-51).
 * Source of truth: ARCHITECTURE.md §4 (agent_runs + agent_events).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { serverAdmin } from '@/lib/db';
import type { Signal } from '@/lib/observe/types';
import type { Proposal, Verdict } from '@/lib/policy/types';

export type RunTrigger = 'internal' | 'external' | 'ai_buyer';
export type RunStatus = 'running' | 'executed' | 'rejected' | 'failed' | 'no_signal';
export type PhaseT = 'observe' | 'decide' | 'policy' | 'execute' | 'result';
export type EventLevel = 'info' | 'warn' | 'block' | 'error';

export interface AgentEvent {
  id?: number;
  run_id: string;
  seq: number;
  phase: PhaseT;
  level: EventLevel;
  message: string;
  payload?: any;
  created_at?: string;
}

export interface AgentRun {
  id: string;
  trigger: RunTrigger;
  day_index: number;
  status: RunStatus;
  signal?: Signal | null;
  proposal?: Proposal | null;
  proposal_retry?: Proposal | null;
  verdict?: Verdict | null;
  execution?: any | null;
  retry_count: number;
  narrative?: string | null;
  started_at: string;
  finished_at?: string | null;
}

/**
 * Creates a new agent_runs entry in Supabase and returns its UUID.
 */
export async function createAgentRun(
  db: SupabaseClient,
  trigger: RunTrigger,
  dayIndex: number,
  signal?: Signal | null,
): Promise<string> {
  const { data, error } = await db
    .from('agent_runs')
    .insert({
      trigger,
      day_index: dayIndex,
      status: 'running',
      signal: signal ?? null,
      retry_count: 0,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create agent_runs entry: ${error.message}`);
  }

  return data.id;
}

/**
 * Updates fields of an existing agent_runs entry.
 */
export async function updateAgentRun(
  db: SupabaseClient,
  runId: string,
  updates: Partial<{
    status: RunStatus;
    signal: Signal | null;
    proposal: Proposal | null;
    proposal_retry: Proposal | null;
    verdict: Verdict | null;
    execution: any | null;
    retry_count: number;
    narrative: string | null;
    finished_at: string;
  }>,
): Promise<void> {
  const { error } = await db
    .from('agent_runs')
    .update(updates)
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to update agent_runs (${runId}): ${error.message}`);
  }
}

/**
 * Logs an event with sequential ordering (seq) for a run into agent_events.
 */
export async function logAgentEvent(
  db: SupabaseClient,
  runId: string,
  seq: number,
  phase: PhaseT,
  level: EventLevel,
  message: string,
  payload?: any,
): Promise<void> {
  const { error } = await db.from('agent_events').insert({
    run_id: runId,
    seq,
    phase,
    level,
    message,
    payload: payload ?? null,
  });

  if (error) {
    throw new Error(`Failed to log agent_event (run_id=${runId}, seq=${seq}): ${error.message}`);
  }
}

/**
 * Helper to fetch all events for a run ordered by seq ascending.
 */
export async function fetchRunEvents(
  db: SupabaseClient,
  runId: string,
): Promise<AgentEvent[]> {
  const { data, error } = await db
    .from('agent_events')
    .select('*')
    .eq('run_id', runId)
    .order('seq', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch agent_events (${runId}): ${error.message}`);
  }

  return (data ?? []) as AgentEvent[];
}
