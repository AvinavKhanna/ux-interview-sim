import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { supabaseServer } from '@/lib/supabase';
import { STT_MODEL } from '@/lib/models';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('audio') as File | null;
    const sessionId = String(form.get('sessionId') || '');
    if (!file || !sessionId) {
      return NextResponse.json({ error: 'missing inputs' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const supabase = supabaseServer();

    // Normalize the file into a supported format
    const safeFile = new File([await file.arrayBuffer()], 'audio.webm', {
      type: 'audio/webm',
    });

    // 1) STT
    const transcription = await openai.audio.transcriptions.create({
      model: STT_MODEL,
      file: await toFile(safeFile),
    });
    const transcript = (transcription as any).text?.trim() || '';
    if (!transcript) return new NextResponse(null, { status: 204 });

    // 2) Load persona/system prompt
    const { data: session } = await supabase
      .from('sessions')
      .select('id, persona_id')
      .eq('id', sessionId)
      .single();
    const { data: persona } = await supabase
      .from('personas')
      .select('system_prompt, voice')
      .eq('id', session?.persona_id)
      .single();

    // 3) Persona reply
const replyRes = await fetch(new URL('/api/reply', req.url), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    userText: transcript,
    personaPrompt: persona?.system_prompt || '',
  }),
});

if (!replyRes.ok) {
  const errJson = await replyRes.json().catch(() => ({}));
  console.error('/api/reply failed:', errJson);
  return NextResponse.json({ error: errJson?.error || 'reply failed' }, { status: 502 });
}

const { replyText } = await replyRes.json();
if (!replyText || !replyText.trim()) {
  return NextResponse.json({ error: 'Empty reply from model' }, { status: 502 });
}

// 4) TTS (non-blocking)
let audioUrl: string | null = null;
try {
  const ttsRes = await fetch(new URL('/api/tts', req.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: replyText, voice: persona?.voice || 'alloy' }),
  });

  if (ttsRes.ok) {
    const { audioUrl: url, audioBase64 } = await ttsRes.json();
    audioUrl = url || audioBase64 || null; // support data: URL fallback
  } else {
    const e = await ttsRes.json().catch(() => ({}));
    console.warn('/api/tts failed (non-blocking):', e);
  }
} catch (e) {
  console.warn('/api/tts threw (non-blocking):', (e as any)?.message || e);
}

// 5) Save both turns
await supabase.from('turns').insert([
  { session_id: sessionId, role: 'user', text: transcript },
  { session_id: sessionId, role: 'persona', text: replyText, audio_url: audioUrl },
]);

return NextResponse.json({ transcript, replyText, ttsUrl: audioUrl });


return NextResponse.json({ transcript, replyText, ttsUrl: audioUrl });
  } catch (e: any) {
    console.error('[interview] error', e);
    return NextResponse.json({ error: e.message || 'interview failed' }, { status: 500 });
  }
}