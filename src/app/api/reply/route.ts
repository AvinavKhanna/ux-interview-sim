import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { CHAT_MODEL } from '@/lib/models';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { userText = '', personaPrompt = '', sessionContext = '' } = await req.json();
    if (!userText.trim()) {
      return NextResponse.json({ error: 'userText is required' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const system = [
      personaPrompt.trim(),
      'You are the interviewee. Stay strictly in character.',
      'Be concise and natural. One or two sentences unless explicitly asked to elaborate.',
      sessionContext ? `Context: ${sessionContext}` : '',
    ].filter(Boolean).join('\n');

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL || 'gpt-4o-mini', // fallback to a known-good model
      // 🚫 No temperature here (some models only allow the default=1)
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
    });

    const replyText = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!replyText) {
      return NextResponse.json({ error: 'Empty reply from model' }, { status: 502 });
    }

    return NextResponse.json({ replyText });
  } catch (e: any) {
    console.error('/api/reply error:', e?.response?.data || e?.message || e);
    return NextResponse.json({ error: e?.message || 'reply failed' }, { status: 500 });
  }
}
