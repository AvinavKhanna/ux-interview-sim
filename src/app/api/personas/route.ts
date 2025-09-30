import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET() {
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('personas').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = supabaseServer();
  // Normalize inputs without adding silent defaults
  const cleanStr = (v: any) => (typeof v === 'string' ? v.trim() : undefined);
  const asNumber = (v: any) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return undefined;
  };
  const asList = (v: any) => Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? v.split(/\r?\n|,|;/).map((s)=>s.trim()).filter(Boolean) : undefined);

  const insert = {
    name: cleanStr(body.name) ?? null,
    age: asNumber(body.age) ?? null,
    occupation: cleanStr(body.occupation) ?? null,
    techfamiliarity: cleanStr(body.techFamiliarity) ?? null,
    personality: cleanStr(body.personality) ?? null,
    painpoints: asList(body.painPoints) ?? null,
    demographics: (body.demographics && typeof body.demographics === 'object') ? body.demographics : {},
    traits: body.traits ?? null,
    goals: body.goals ?? null,
    frustrations: body.frustrations ?? null,
    notes: cleanStr(body.notes) ?? null,
  } as Record<string, unknown>;

  const { data, error } = await supabase.from('personas')
    .insert(insert)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('personas')
    .update({
      name: body.name,
      demographics: body.demographics,
      traits: body.traits,
      goals: body.goals,
      frustrations: body.frustrations,
      notes: body.notes
    })
    .eq('id', body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const supabase = supabaseServer();
  const { error } = await supabase.from('personas').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
