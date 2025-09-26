import { NextResponse } from "next/server";
import { SessionStore } from "@/lib/sessionStore";
import type { SessionMeta, SessionReport, Turn } from "@/types/report";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = params?.id || "";
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
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

