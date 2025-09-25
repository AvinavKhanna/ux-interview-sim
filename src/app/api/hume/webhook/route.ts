import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // Read raw body for signature verification
  const raw = await req.text();
  const signature = req.headers.get('x-hume-signature') || req.headers.get('X-Hume-Signature');
  const secret = process.env.HUME_WEBHOOK_SECRET || '';
  if (!secret || signature !== secret) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const type: string = String(evt.type || evt.event || '').toLowerCase();
  const meta = evt.metadata || {};
  const sessionId: string | undefined = meta.sessionId || evt.sessionId || evt.session_id;
  const roleRaw: string | undefined = evt.role || evt.speaker || evt.data?.role;
  const role = normalizeRole(roleRaw);
  const text: string | undefined = evt.text || evt.data?.text || evt.message || evt.payload?.text;
  const ts: string = toIso(evt.timestamp || evt.data?.timestamp || Date.now());
  const id: string | undefined = evt.id || evt.event_id || evt.data?.id;

  const sb = supabaseServer();

  try {
    if (type.includes('transcript') || type.includes('message')) {
      if (sessionId && text && role) {
        // Idempotency via event id stored on session.feedback.seen_event_ids
        const { data: s } = await sb.from('sessions').select('feedback').eq('id', sessionId).single();
        const feedback = (s as any)?.feedback || {};
        const seen: string[] = Array.isArray(feedback.seen_event_ids) ? feedback.seen_event_ids : [];
        if (!id || !seen.includes(id)) {
          await sb.from('turns').insert({ session_id: sessionId, role, text, created_at: ts });
          const nextSeen = (seen.concat(id ? [id] : [])).slice(-200);
          feedback.seen_event_ids = nextSeen;
          await sb.from('sessions').update({ feedback }).eq('id', sessionId);
        }
      }
      console.log('[hume:webhook]', { type, sessionId, role, text });
    } else if (type.includes('emotion') || type.includes('signal')) {
      if (sessionId) {
        // append raw emotion event into sessions.feedback.emotions[] (fail-soft)
        const { data: s } = await sb.from('sessions').select('feedback').eq('id', sessionId).single();
        const feedback = (s as any)?.feedback || {};
        const arr = Array.isArray(feedback.emotions) ? feedback.emotions : [];
        arr.push(safeSlice(evt, 2048));
        feedback.emotions = arr;
        await sb.from('sessions').update({ feedback }).eq('id', sessionId);
      }
      console.log('[hume:webhook]', { type, sessionId });
    } else if (type.includes('ended') || type.includes('end')) {
      if (sessionId) {
        await sb.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId);
      }
      console.log('[hume:webhook]', { type, sessionId });
    } else {
      // Unknown event; log minimally
      console.log('[hume:webhook]', { type: type || 'unknown', sessionId });
    }
  } catch (e) {
    // swallow to keep webhook fast
  }

  return NextResponse.json({ ok: true });
}

function normalizeRole(v?: string): 'user' | 'persona' | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (s.includes('assistant') || s.includes('agent') || s.includes('persona')) return 'persona';
  return 'user';
}
function toIso(v: any): string { return new Date(v).toISOString(); }
function safeSlice(obj: any, max: number) {
  try { const s = JSON.stringify(obj); return JSON.parse(s.length > max ? s.slice(0, max) : s); } catch { return {}; }
}
