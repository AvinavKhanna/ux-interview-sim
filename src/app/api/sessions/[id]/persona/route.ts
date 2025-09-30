import { NextResponse } from "next/server";
import { getPersonaSummary } from "@/lib/persona/getPersonaSummary";
import { SessionStore } from "@/lib/sessionStore";
import { normalizePersonaSummary } from "@/lib/persona/normalize";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const mem = SessionStore.get(id);
    const fromMem = mem?.meta?.personaSummary ? normalizePersonaSummary(mem.meta.personaSummary) : null;
    let personaSummary = fromMem || (await getPersonaSummary(id));
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[persona:api:persona]', { id, hasMem: !!fromMem, summaryKeys: personaSummary ? Object.keys(personaSummary as any).length : 0 });
    }
    if (!personaSummary || Object.keys(personaSummary as any).length === 0) {
      // Try adopt local header if provided by client
      try {
        const hdr = req.headers.get('x-persona-local');
        if (hdr && hdr.trim()) {
          const local = normalizePersonaSummary(JSON.parse(hdr));
          if (Object.keys(local as any).length > 0) {
            personaSummary = local;
            SessionStore.upsert(id, { meta: { personaSummary: local } as any });
          }
        }
      } catch {}
      if (!personaSummary || Object.keys(personaSummary as any).length === 0) {
        await new Promise((r) => setTimeout(r, 120));
        personaSummary = await getPersonaSummary(id);
      }
    }
    return NextResponse.json({ personaSummary });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
