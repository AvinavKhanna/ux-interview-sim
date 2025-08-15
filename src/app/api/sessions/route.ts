import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb.from('sessions').select('*').order('started_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json(); // { project_id, persona_id }
  const sb = supabaseServer();
  const { data, error } = await sb.from('sessions')
    .insert({
      project_id: body.project_id || null,
      persona_id: body.persona_id || null
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}