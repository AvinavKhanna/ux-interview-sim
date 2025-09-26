import { NextResponse } from "next/server";
import { SessionStore } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params?.id || "";
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const report = SessionStore.get(id);
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ report });
}

