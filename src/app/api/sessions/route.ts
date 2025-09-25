import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';


export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb.from('sessions').select('*').order('started_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json(); // allow { project_id, persona_id } or { projectId, personaId, persona }
  const sb = supabaseServer();
  const project_id = body.project_id ?? body.projectId ?? null;
  let persona_id: string | null = body.persona_id ?? body.personaId ?? null;

  // If persona_id is missing or not a UUID, create a stub persona row using the provided persona payload
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  const looksUuid = typeof persona_id === 'string' && UUID_RE.test(persona_id);

  if (!looksUuid) {
    const p = body.persona || {};
    const name = typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : 'Unnamed';
    const age = Number.isFinite(p?.age) ? Number(p.age) : 35;
    const occupation = typeof p?.occupation === 'string' && p.occupation.trim() ? p.occupation.trim() : 'Unknown';
    const techfamiliarity = typeof p?.techFamiliarity === 'string' ? p.techFamiliarity : 'medium';
    const painpoints: string[] = Array.isArray(p?.painPoints) ? p.painPoints.slice(0, 8).map(String) : [];
    const personality = typeof p?.personality === 'string' ? p.personality : null;
    const demographics = (p?.demographics && typeof p.demographics === 'object') ? p.demographics : {};

    const ins = await sb.from('personas')
      .insert({
        name,
        age,
        occupation,
        techfamiliarity,
        painpoints,
        personality,
        demographics,
        notes: typeof p?.notes === 'string' ? p.notes : null,
        goals: Array.isArray(p?.goals) ? p.goals.map(String) : null,
        frustrations: Array.isArray(p?.frustrations) ? p.frustrations.map(String) : null,
      })
      .select('id')
      .single();

    if (ins.error) {
      return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }
    persona_id = ins.data?.id || null;
  }

  const { data, error } = await sb.from('sessions')
    .insert({ project_id, persona_id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
