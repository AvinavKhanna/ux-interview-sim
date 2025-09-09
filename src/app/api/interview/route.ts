import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { createClient } from '@supabase/supabase-js';
import { STT_MODEL } from '@/lib/models';

export const runtime = 'nodejs'; // ensure File APIs available

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('audio') as File | null;
    const sessionId = String(form.get('sessionId') || '');
    if (!file || !sessionId) return NextResponse.json({ error: 'missing inputs' }, { status: 400 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // 1) STT
    const transcription = await openai.audio.transcriptions.create({
      model: STT_MODEL,
      file: await toFile(file),
    });
    const transcript = (transcription as any).text?.trim() || '';
    if (!transcript) return new NextResponse(null, { status: 204 });

    // 2) Load persona/system prompt
    const { data: session } = await supabase.from('sessions').select('id, persona_id').eq('id', sessionId).single();
    const { data: persona } = await supabase.from('personas').select('system_prompt, voice').eq('id', session?.persona_id).single();

    // 3) Persona reply
    const replyRes = await fetch(new URL('/api/reply', req.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userText: transcript, personaPrompt: persona?.system_prompt || '' }),
    });
    const { replyText } = await replyRes.json();

    // 4) TTS
    const ttsRes = await fetch(new URL('/api/tts', req.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: replyText, voice: persona?.voice || 'alloy' }),
    });
    const { audioUrl } = await ttsRes.json();

    // 5) Save both turns
    await supabase.from('turns').insert([
      { session_id: sessionId, role: 'user', text: transcript },
      { session_id: sessionId, role: 'persona', text: replyText, audio_url: audioUrl },
    ]);

    return NextResponse.json({ transcript, replyText, ttsUrl: audioUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'interview failed' }, { status: 500 });
  }
}