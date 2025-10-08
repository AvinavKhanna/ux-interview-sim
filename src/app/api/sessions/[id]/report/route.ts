import { NextResponse } from "next/server";
import { SessionStore } from "@/lib/sessionStore";
import { supabaseServer } from "@/lib/supabase";
import type { SessionReport } from "@/types/report";
import { buildAnalytics } from "@/lib/analysis/interview";
import { buildInterviewSummary } from "@/lib/analytics/summary";

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
        // Fallback: allow transcript saved under feedback JSON
        if ((!turns || turns.length === 0) && (data as any)?.feedback && Array.isArray((data as any).feedback.transcript)) {
          turns = (data as any).feedback.transcript as any[];
        }
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
        // Derive a coarse emotion/tone summary from feedback.emotions if available
        const emotionSummary = (() => {
          try {
            const fb = (data as any)?.feedback;
            const arr: any[] = Array.isArray(fb?.emotions) ? fb.emotions : [];
            const counter = new Map<string, { sum: number; n: number }>();
            for (const evt of arr) {
              const preds: any[] = (evt?.emotion_predictions || evt?.predictions || []) as any[];
              for (const p of preds) {
                const name = String(p?.name || p?.label || '').toLowerCase();
                const score = Number(p?.score || p?.value || 0);
                if (!name) continue;
                const cur = counter.get(name) || { sum: 0, n: 0 };
                cur.sum += score; cur.n += 1; counter.set(name, cur);
              }
            }
            const items = Array.from(counter.entries()).map(([k, v]) => ({ name: k, avg: v.sum / Math.max(1, v.n) }));
            items.sort((a, b) => b.avg - a.avg);
            return items.slice(0, 3).map(x => x.name).join(', ');
          } catch { return undefined; }
        })();
        report = { meta: { id, startedAt, stoppedAt, personaSummary, emotionSummary, durationMs: stoppedAt ? (stoppedAt - startedAt) : undefined }, turns } as SessionReport;
        SessionStore.set(id, report);
      }
    } catch {}
  }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const analytics = buildAnalytics(report.turns);
    // Build concise overall summary from analytics and transcript metrics
    const durMs = Number((report.meta as any)?.durationMs) || (analytics.duration?.durationMs ?? 0);
    const userPct = (analytics.talkTimeMs?.userPct ?? analytics.talkTime?.userPct ?? 0) / 100;
    const asstPct = (analytics.talkTimeMs?.assistantPct ?? analytics.talkTime?.assistantPct ?? 0) / 100;
    // Recompute quick cut-in interruptions per minute (user before assistant <2s)
    const stamps = report.turns.map(t=> Number(t.at)).filter(n=> Number.isFinite(n));
    const durationMs = durMs || (stamps.length ? Math.max(...stamps) - Math.min(...stamps) : 0);
    let interruptCount = 0;
    for (let i=1;i<report.turns.length;i++){
      const t = report.turns[i];
      if (t.speaker !== 'user') continue;
      let j=i-1; while (j>=0 && report.turns[j].speaker==='user') j--; 
      if (j>=0 && report.turns[j].speaker==='assistant'){
        const delta = Math.abs((Number(t.at)||0) - (Number(report.turns[j].at)||0));
        if (delta < 2000) interruptCount += 1;
      }
    }
    const mins = durationMs > 0 ? (durationMs/60000) : 0;
    const ipm = mins ? (interruptCount / mins) : 0;
    const depth = analytics.followUpChainDepth ?? 0;
    const overallSummary = buildInterviewSummary({
      durationMs,
      talkRatio: { interviewer: userPct, participant: asstPct },
      interruptionsPerMin: ipm,
      followupDepth: depth,
    });
    (report as any).overallSummary = overallSummary;
    const scoreReason = String((analytics as any)?.score?.scoreReason || '').trim() || undefined;
    (report as any).scoreReason = scoreReason;
    return NextResponse.json({ report, analytics, overallSummary, scoreReason }, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return NextResponse.json({ report }, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
