export const runtime = 'nodejs';
import { openai } from '@/lib/openai';
import { CHAT_MODEL } from '@/lib/models';


export async function POST(req: Request) {
  try {
    const { description } = await req.json();
    if (!description || typeof description !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing description' }), { status: 400 });
    }

    const prompt = `Given this UX project description, suggest THREE realistic interview personas as a JSON array.

Each array item MUST be exactly this shape (no extra keys):
{
  "name": string,
  "occupation": string,
  "demographics": { "age": number, "location": string },
  "traits": { "techSavvy": boolean },
  "goals": string,
  "frustrations": string,
  "notes": string
}

Rules:
- Make occupations varied and plausible for the domain (avoid duplicates).
- Keep language concise and grounded.
- Output ONLY the JSON array, no prose, no code fences.

Description: """${description}"""`;

    // Prefer CHAT_MODEL but fall back if not available
    let raw = '[]';
    try {
      const r1 = await openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = r1.choices[0].message?.content ?? '[]';
    } catch (e) {
      const r2 = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = r2.choices[0].message?.content ?? '[]';
    }
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed: unknown;
    try { parsed = JSON.parse(cleaned); }
    catch { return new Response(JSON.stringify({ error: 'Model did not return valid JSON', raw: cleaned }), { status: 502 }); }

    if (!Array.isArray(parsed)) {
      return new Response(JSON.stringify({ error: 'Expected a JSON array', raw: cleaned }), { status: 502 });
    }
    return new Response(JSON.stringify(parsed), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'Server error' }), { status: 500 });
  }
}
