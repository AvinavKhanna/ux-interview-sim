import { NextResponse } from "next/server";
import { SessionStore } from "@/lib/sessionStore";
import type { SessionMeta, SessionReport, Turn } from "@/types/report";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  try {
    const body = (await req.json().catch(() => ({}))) as { turns?: Turn[]; meta?: Partial<SessionMeta> };
    const stoppedAt = Date.now();
    const cur = SessionStore.get(id) || ({ meta: { id, startedAt: stoppedAt }, turns: [] } as SessionReport);
    const turns = Array.isArray(body.turns) ? body.turns : cur.turns;
    const meta: SessionMeta = {
      ...cur.meta,
      ...(body.meta || {}),
      id,
      stoppedAt: body?.meta?.stoppedAt ?? stoppedAt,
    } as SessionMeta;
    const durationMs = Math.max(0, (meta.stoppedAt || stoppedAt) - (meta.startedAt || stoppedAt));
    const next: SessionReport = { meta: { ...meta, durationMs }, turns };
    SessionStore.set(id, next);
    // Persist end time and store transcript into feedback JSON (no schema change required)
    try {
      const sb = supabaseServer();
      const iso = new Date(meta.stoppedAt || stoppedAt).toISOString();
      // 1) Always set ended_at (safe on all schemas that include it)
      await sb.from('sessions').update({ ended_at: iso }).eq('id', id);
      // 2) Merge transcript into feedback JSON to avoid relying on a 'transcript' column
      try {
        const { data: row } = await sb.from('sessions').select('feedback').eq('id', id).single();
        const feedback = (row as any)?.feedback && typeof (row as any).feedback === 'object' ? (row as any).feedback : {};
        // Only attach minimal transcript for report recovery; turns table remains primary for Hume webhook.
        if (Array.isArray(turns) && turns.length) {
          (feedback as any).transcript = turns;
        }
        if ((meta as any)?.personaSummary) {
          (feedback as any).personaSummary = (meta as any).personaSummary;
        }
        await sb.from('sessions').update({ feedback }).eq('id', id);
      } catch {}
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[stop:server:db]', { status: 200, error: undefined });
      }
    } catch {}
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[stop:server:saved]', { id, turns: turns?.length ?? 0, durationMs });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}


