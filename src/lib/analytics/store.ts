import { supabaseBrowser } from '@/lib/supabase';

const getClient = () => {
  try {
    return supabaseBrowser();
  } catch (err) {
    console.warn('[analytics:disabled]', err); // why: Supabase not configured locally, avoid crashing
    return null;
  }
};

export async function saveTurn(params: { sessionId: string; role: 'user' | 'persona'; text: string; emotions?: unknown }): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.from('turns').insert({
      session_id: params.sessionId,
      role: params.role,
      text: params.text,
      emotions: params.emotions ?? null,
      created_at: new Date().toISOString(), // why: ensure consistent timestamp even if DB default missing
    });
  } catch (err) {
    console.warn('[analytics:saveTurn]', err); // why: logging sufficient; analytics is best-effort
  }
}

export async function appendCoaching(params: { sessionId: string; cue: unknown }): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.from('coach_feedback').insert({
      session_id: params.sessionId,
      cue: params.cue,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[analytics:appendCoaching]', err);
  }
}
