import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client — ALL writes go through this, server-side only.
 * The throw below is what makes NFR-4 a runtime property instead of a
 * code-review promise (PHASES §12 frozen after Phase 1).
 */
export function serverAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'FATAL: serverAdmin() called in the browser — service-role key must never reach the client (NFR-4)',
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Browser-safe anon client — read-only via RLS; no write policy exists for anon anywhere. */
export function publicRead(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
