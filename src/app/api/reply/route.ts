import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { CHAT_MODEL } from '@/lib/models';

export async function POST(req: Request) {
  try {
    const { userText, personaPrompt, sessionContext } = await req.json();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const system = `${personaPrompt}
- Stay in character. Be concise and natural.
- Answer as the user you are role-playing, not as an assistant.
- If the question is unclear, ask a brief clarifying question.`;

    // ✅ Build messages with an explicit type (no spread/ternary shenanigans)
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
    ];
    if (sessionContext) {
      messages.push({ role: 'system', content: `Context: ${sessionContext}` });
    }
    messages.push({ role: 'user', content: userText });

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.7,
      messages,
    });

    const replyText = completion.choices[0]?.message?.content?.trim() || '…';
    return NextResponse.json({ replyText });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'reply failed' }, { status: 500 });
  }
}