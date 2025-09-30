import { NextResponse } from "next/server";
import { SessionStore } from "@/lib/sessionStore";
import { supabaseServer } from "@/lib/supabase";
import type { SessionReport } from "@/types/report";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  let report = SessionStore.get(id);
  if (!report) {
    try {
      const sb = supabaseServer();
      const { data } = await sb
        .from('sessions')
        .select('id, transcript, created_at, ended_at, feedback, persona_summary')
        .eq('id', id)
        .maybeSingle();
      if (data) {
        let turns = Array.isArray((data as any).transcript) ? (data as any).transcript as any[] : [];
        if (!turns || turns.length === 0) {
          try {
            const tr = await sb
              .from('turns')
              .select('role,text,created_at')
              .eq('session_id', id)
              .order('created_at', { ascending: true });
            if (!tr.error && Array.isArray(tr.data)) {
              turns = tr.data.map((row: any) => ({
                speaker: String(row.role).includes('assistant') ? 'assistant' : 'user',
                text: row.text,
                at: Date.parse(row.created_at || '') || Date.now(),
              }));
            }
          } catch {}
        }
        const startedAt = Date.parse((data as any).created_at || '') || Date.now();
        const stoppedAt = Date.parse((data as any).ended_at || '') || undefined;
        const personaSummary = (data as any).persona_summary || (data as any)?.feedback?.personaSummary || undefined;
        report = { meta: { id, startedAt, stoppedAt, personaSummary, durationMs: stoppedAt ? (stoppedAt - startedAt) : undefined }, turns } as SessionReport;
        SessionStore.set(id, report);
      }
    } catch {}
  }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ report });
}
