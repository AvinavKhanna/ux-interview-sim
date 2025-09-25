import { NextResponse } from 'next/server';
import { z } from 'zod';
import { openai } from '@/lib/openai';

const RequestSchema = z.object({
  sessionId: z.string().min(1),
  persona: z
    .object({
      name: z.string().min(1),
      age: z.number().nullable().optional(),
      occupation: z.string().nullable().optional(),
      tech: z.string().nullable().optional(),
    })
    .optional(),
  project: z
    .object({
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
    })
    .optional(),
  lastUserUtterance: z.string().min(1),
  lastAssistantUtterance: z.string().optional(),
});

const CoachCueSchema = z.object({
  tag: z.enum(['open', 'leading', 'double-barrel', 'interrupt', 'probe', 'rapport', 'empathy', 'scope']),
  quality: z.enum(['great', 'good', 'neutral', 'risky', 'problem']),
  suggestion: z.string().min(1),
  why: z.string().min(1),
});

const stripFences = (input: string) => {
  const trimmed = input.trim().replace(/```json?/gi, '```');
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.slice(3, -3).trim();
  }
  return trimmed;
};

const flattenWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim(); // why: makes JSON detection reliable

export async function POST(request: Request) {
  let payload: z.infer<typeof RequestSchema>;
  try {
    payload = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: 'invalid-request', issues: err }, { status: 400 });
  }

  const prompt = `You are a UX interview coach. Analyze ONLY the most recent interviewer question using the short context below.
Return STRICT JSON with fields: tag, quality, suggestion, why.

Guidelines:
- Prefer positive feedback when deserved; don’t nag on greetings.
- If question is leading or double-barreled, say so and rewrite it.
- If persona likely felt confused or tense, suggest a gentle probe.
- Be specific and actionable.

Persona: ${payload.persona?.name ?? 'Unknown'} (${payload.persona?.occupation ?? 'unknown occupation'}, age ${payload.persona?.age ?? 'unknown'}, tech: ${payload.persona?.tech ?? 'unknown'})
Project: ${payload.project?.title ?? 'Unknown'} — ${payload.project?.description ?? 'No description'}
Last assistant reply: ${payload.lastAssistantUtterance ?? '(none)'}
Interviewer question: ${payload.lastUserUtterance}`;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_COACH_MODEL ?? 'gpt-4o-mini', // why: fast, cost-effective model for real-time hints
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        { role: 'system', content: 'You are a UX interview coach. Respond only with JSON.' },
        { role: 'user', content: prompt },
      ],
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error('empty-response');

    const cleaned = flattenWhitespace(stripFences(rawContent));
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('invalid-json');
    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    if (typeof parsed.quality === 'string') parsed.quality = parsed.quality.toLowerCase(); // why: model may capitalise labels
    if (typeof parsed.tag === 'string') parsed.tag = parsed.tag.toLowerCase();

    const cue = CoachCueSchema.parse(parsed);
    return NextResponse.json(cue, { status: 200 });
  } catch (err) {
    console.error('[coach:error]', err);
    return NextResponse.json({ error: 'coach-failed', issues: err }, { status: 400 });
  }
}
