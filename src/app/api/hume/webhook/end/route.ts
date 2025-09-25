import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    await request.json().catch(() => ({})); // why: consume body so node doesn't warn if client sends JSON
  } catch (err) {
    return NextResponse.json({ ok: true }, { status: 200 }); // why: even malformed input should not fail shutdown
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
