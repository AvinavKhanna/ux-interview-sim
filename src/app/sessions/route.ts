import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { ensurePersonaSummary, type PersonaSummary } from '@/types/persona';

// GET /api/sessions?projectId=... (optional)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');

  const sb = supabaseServer();
  let query = sb.from('sessions').select('*').order('created_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/sessions
export async function POST(req: Request) {
  const body = await req.json();
  const sb = supabaseServer();
  // Accept either personaSummary or legacy persona; normalize if provided
  const raw = body.personaSummary ?? body.persona ?? null;
  let snapshot: PersonaSummary | null = null;
  try { if (raw) snapshot = ensurePersonaSummary(raw); } catch {}

  const { data, error } = await sb
    .from('sessions')
    .insert({
      project_id: body.projectId,
      persona_id: body.personaId,
      // Store snapshot if the column exists; Supabase will ignore unknown keys in insert only if column exists.
      // We include it here assuming a jsonb column named persona_summary is present.
      persona_summary: snapshot ?? null,
      transcript: body.transcript ?? [],
      feedback: body.feedback ?? null,
    } as any)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Echo persona_summary for client usage
  return NextResponse.json({ ...data, persona_summary: snapshot ?? (data as any)?.persona_summary ?? null });
}

// PUT /api/sessions?id=...
export async function PUT(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const body = await req.json();
  const sb = supabaseServer();
  const { data, error } = await sb
    .from('sessions')
    .update({
      transcript: body.transcript,
      feedback: body.feedback,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/sessions?id=...
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const sb = supabaseServer();
  const { error } = await sb.from('sessions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
