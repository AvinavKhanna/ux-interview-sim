import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';

async function synthesize(openai: OpenAI, text: string, voice: string) {
  // Try modern model first, then fall back to legacy TTS
  const tryModels = [
    { model: 'gpt-4o-mini-tts' }, // newer
    { model: 'tts-1' },           // legacy, widely available
  ];

  let lastErr: any = null;

  for (const m of tryModels) {
    try {
      const rsp = await openai.audio.speech.create({
        model: m.model,
        voice,
        input: text,
        // mp3 is default for both, but set explicitly for safety
        
      });
      const arrayBuf = await rsp.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (e: any) {
      lastErr = e;
      // Log the exact server message to your terminal
      console.error(`[TTS ${m.model}]`, e?.response?.data || e?.message || e);
    }
  }

  throw new Error(
    lastErr?.response?.data?.error?.message ||
    lastErr?.message ||
    'TTS failed'
  );
}

export async function POST(req: Request) {
  try {
    const { text, voice = 'alloy' } = await req.json();
    if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const audioBuf = await synthesize(openai, text, voice);

    // OPTIONAL: Save to Supabase Storage. Comment out if you want inline base64 only.
    const supabase = supabaseServer();
    const fileName = `tts/${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
    const { error: upErr } = await supabase.storage
      .from('public') // change if your bucket has another name
      .upload(fileName, audioBuf, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (upErr) {
      console.error('Supabase upload error:', upErr);
      // fall back to inline base64 so the client can still play it
      const base64 = `data:audio/mpeg;base64,${audioBuf.toString('base64')}`;
      return NextResponse.json({ audioUrl: null, audioBase64: base64 });
    }

    const { data: pub } = supabase.storage.from('public').getPublicUrl(fileName);
    return NextResponse.json({ audioUrl: pub.publicUrl, audioBase64: null });
  } catch (e: any) {
    console.error('/api/tts error:', e?.response?.data || e?.message || e);
    return NextResponse.json({ error: e?.message || 'tts failed' }, { status: 400 });
  }
}