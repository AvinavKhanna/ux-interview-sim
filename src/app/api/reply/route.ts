import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { CHAT_MODEL } from '@/lib/models';
import { supabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';

function capHistory(
  items: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxItems = 14
) {
  if (!items?.length) return [];
  return items.slice(Math.max(0, items.length - maxItems));
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const userText: string = (payload.userText || '').trim();
    const sessionId: string = String(payload.sessionId || '').trim();
    if (!userText || !sessionId) {
      return NextResponse.json({ error: 'userText and sessionId are required' }, { status: 400 });
    }

    // 1) Load session, persona, and recent turns
    const sb = supabaseServer();
    const { data: session } = await sb
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    const personaId = (session as any)?.persona_id ?? (session as any)?.personaId ?? null;
    const sessionSummary = (session as any)?.summary || (session as any)?.feedback?.summary || '';

    const { data: persona } = await sb
      .from('personas')
      .select('system_prompt, name, age, occupation, techfamiliarity, painpoints, personality, demographics, notes')
      .eq('id', personaId)
      .single();

    const { data: turns } = await sb
      .from('turns')
      .select('role, text, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(20);

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = (turns || [])
      .filter((t) => t.text && t.text.trim().length)
      .map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', content: t.text! }));

    console.log('[reply] persona', { id: personaId, name: (persona as any)?.name });

    // 2) Build persona context + prompt
    const demo = (persona as any)?.demographics || {};
    const facts: string[] = [];
    if ((persona as any)?.name) facts.push(`Name: ${(persona as any).name}`);
    if ((persona as any)?.age) facts.push(`Age: ${(persona as any).age}`);
    if (demo.location) facts.push(`Location: ${demo.location}`);
    if ((persona as any)?.occupation) facts.push(`Occupation: ${(persona as any).occupation}`);
    if ((persona as any)?.techfamiliarity) facts.push(`Tech familiarity: ${(persona as any).techfamiliarity}`);
    if ((persona as any)?.personality) facts.push(`Personality: ${(persona as any).personality}`);
    if (Array.isArray((persona as any)?.painpoints) && (persona as any).painpoints.length) {
      facts.push(`Pain points: ${((persona as any).painpoints as string[]).join('; ')}`);
    }
    if ((persona as any)?.notes) facts.push(`Notes: ${(persona as any).notes}`);
    const personaContext = facts.join('\n');

    const derivedPrompt = `You are roleplaying as a UX interview participant. Stay in character.
Persona summary:
${personaContext || 'N/A'}

Rules:
- Answer naturally in 1–3 concise sentences.
- Do not over-disclose information unless specifically probed.
- Maintain consistency with the persona summary; avoid contradictions.
- If unclear, ask one brief clarifying question first.`;

    const personaPrompt = (persona as any)?.system_prompt && String((persona as any).system_prompt).trim()
      ? String((persona as any).system_prompt)
      : derivedPrompt;

    const system = [
      personaContext && `Persona Facts:\n${personaContext}`,
      personaPrompt && `Additional Persona Instructions:\n${personaPrompt}`,
      sessionSummary && `Session Summary (for context):\n${sessionSummary}`,
      `You are the interviewee in a UX interview simulator.
- Stay strictly in character; embody the persona's background and personality.
- Be concise and natural (1–3 sentences unless asked to elaborate).
- Do not over-disclose information; reveal details only when probed.
- Maintain context awareness across turns; avoid contradictions.
- If the question is unclear, ask one brief clarifying question first.
- If asked multi‑part questions, address each part directly.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    // 3) Ask the model
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      ...capHistory(history),
      { role: 'user', content: userText },
    ];

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages,
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
