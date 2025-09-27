import { NextResponse } from "next/server";
import { getPersonaSummary } from "@/lib/persona/getPersonaSummary";
import { SessionStore } from "@/lib/sessionStore";
import { normalizePersonaSummary } from "@/lib/persona/normalize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const mem = SessionStore.get(id);
    const fromMem = mem?.meta?.personaSummary ? normalizePersonaSummary(mem.meta.personaSummary) : null;
    const personaSummary = fromMem || (await getPersonaSummary(id));
    return NextResponse.json({ personaSummary });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
