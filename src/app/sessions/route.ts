import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { normalizePersonaSummary, type PersonaSummary } from '@/lib/persona/normalize';
import { SessionStore } from '@/lib/sessionStore';

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
  try { if (raw) snapshot = normalizePersonaSummary(raw); } catch {}

  // If important fields are missing in snapshot, enrich from DB persona row
  try {
    const need = !snapshot || (!snapshot.personality && !snapshot.techFamiliarity && typeof snapshot.age !== 'number');
    const pid = body.personaId || body.persona_id;
    if (pid && (need || (snapshot && (!snapshot.personality || !snapshot.techFamiliarity || typeof snapshot.age !== 'number')))) {
      const { data: row } = await sb
        .from('personas')
        .select('name,age,occupation,techfamiliarity,personality,style,tone,painpoints,notes')
        .eq('id', String(pid))
        .maybeSingle();
      if (row) {
        const fromDb = normalizePersonaSummary({
          name: row.name,
          age: row.age,
          techFamiliarity: row.techfamiliarity,
          personality: row.personality ?? (row as any)?.style ?? (row as any)?.tone,
          occupation: (row as any)?.occupation,
          painPoints: (row as any)?.painpoints,
          extraInstructions: (row as any)?.notes,
        });
        snapshot = { ...(snapshot ?? {}), ...Object.fromEntries(Object.entries(fromDb).filter(([,v]) => v !== undefined)) } as PersonaSummary;
      }
    }
  } catch {}

  // Ensure we have a real persona_id; if not a UUID, create a stub persona row from snapshot/body
  let persona_id: string | null = body.personaId ?? body.persona_id ?? null;
  try {
    const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    const looksUuid = typeof persona_id === 'string' && UUID_RE.test(persona_id);
    if (!looksUuid) {
      const src = snapshot ?? (raw as any) ?? {};
      const clean = (v: any) => (typeof v === 'string' ? v.trim() : undefined);
      const ageNum = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined));
      const toList = (v: any) => Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? v.split(/\r?\n|,|;/).map((s)=>s.trim()).filter(Boolean) : undefined);
      const insert = {
        name: clean(src.name) ?? null,
        age: ageNum(src.age) ?? null,
        occupation: clean((src as any).occupation) ?? null,
        techfamiliarity: clean(src.techFamiliarity) ?? null,
        personality: clean(src.personality) ?? null,
        painpoints: toList(src.painPoints) ?? null,
        notes: clean((src as any).extraInstructions) ?? null,
      } as Record<string, unknown>;
      const ins = await sb.from('personas').insert(insert).select('id').single();
      if (!ins.error && ins.data?.id) persona_id = ins.data.id as string;
    }
  } catch {}

  const { data, error } = await sb
    .from('sessions')
    .insert({
      project_id: body.projectId,
      persona_id,
      // Store snapshot if the column exists; Supabase will ignore unknown keys in insert only if column exists.
      // We include it here assuming a jsonb column named persona_summary is present.
      persona_summary: snapshot ?? null,
      transcript: body.transcript ?? [],
      feedback: body.feedback ?? null,
    } as any)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[persona:post:server]', snapshot ? { name: snapshot.name, age: snapshot.age, techFamiliarity: snapshot.techFamiliarity, personality: snapshot.personality } : { empty: true });
  }
  try {
    const id = (data as any)?.id as string | undefined;
    if (id && snapshot) {
      SessionStore.upsert(id, { meta: { id, startedAt: Date.now(), personaSummary: snapshot } as any });
      // Also persist snapshot inside sessions.feedback for robustness
      try {
        const sb2 = supabaseServer();
        const cur = (data as any)?.feedback || {};
        const next = { ...cur, personaSummary: snapshot };
        await sb2.from('sessions').update({ feedback: next }).eq('id', id);
      } catch {}
    }
  } catch {}
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
