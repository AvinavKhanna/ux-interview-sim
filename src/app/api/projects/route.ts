import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb.from('projects').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const sb = supabaseServer();
  const { data, error } = await sb.from('projects').insert({
    title: body.title || 'Untitled',
    description: body.description || '',
    domain_tags: body.domain_tags || []
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const sb = supabaseServer();
  const { data, error } = await sb.from('projects')
    .update({
      title: body.title,
      description: body.description,
      domain_tags: body.domain_tags || []
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
  const sb = supabaseServer();
  const { error } = await sb.from('projects').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}