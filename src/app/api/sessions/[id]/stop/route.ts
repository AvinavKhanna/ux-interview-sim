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
    // Persist to DB as a fallback across dev reloads
    try {
      const sb = supabaseServer();
      const feedback = { ...(next.meta as any), personaSummary: (next.meta as any)?.personaSummary };
      const up = await sb
        .from('sessions')
        .update({ transcript: turns, feedback, ended_at: new Date(meta.stoppedAt || stoppedAt).toISOString() })
        .eq('id', id);
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[stop:server:db]', { status: up?.status, error: (up as any)?.error?.message });
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
