import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';


const supabase = supabaseServer();

export async function GET() {
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('personas').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('personas')
    .insert({
      name: body.name,
      demographics: body.demographics || {},
      traits: body.traits || {},
      goals: body.goals || '',
      frustrations: body.frustrations || '',
      notes: body.notes || ''
    })
    .select()
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