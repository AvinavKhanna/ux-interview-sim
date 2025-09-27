import { NextResponse } from "next/server";
import { getPersonaSummary } from "@/lib/persona/getPersonaSummary";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const personaSummary = await getPersonaSummary(id);
    return NextResponse.json({ personaSummary });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
