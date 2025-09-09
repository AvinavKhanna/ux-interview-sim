import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { TTS_MODEL } from '@/lib/models';

export async function POST(req: Request) {
  try {
    const { text, voice = 'alloy' } = await req.json();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const audio = await openai.audio.speech.create({
      model: TTS_MODEL, voice, input: text
    });
    const arrayBuffer = await audio.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const path = `tts/${crypto.randomUUID()}.mp3`;
    const { error } = await supabase.storage.from('audio').upload(path, bytes, { contentType: 'audio/mpeg' });
    if (error) throw new Error(error.message);

    const { data } = supabase.storage.from('audio').getPublicUrl(path);
    return NextResponse.json({ audioUrl: data.publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'tts failed' }, { status: 500 });
  }
}