export const runtime = 'nodejs';
import OpenAI from 'openai';

export async function POST(req: Request) {
  try {
    const { description } = await req.json();
    if (!description || typeof description !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing description' }), { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const prompt = `Given this UX project description, suggest 3 realistic interview personas as a valid JSON array.

Each item MUST be exactly:
{
  "name": string,
  "occupation": string,           // e.g., "University student", "Retail associate", "Junior marketer"
  "demographics": { "age": number, "location": string },
  "traits": { "techSavvy": boolean },
  "goals": string,
  "frustrations": string,
  "notes": string
}

Rules:
- Make occupations VARIED and plausible for the project domain (avoid duplicates).
- Keep language concise.
- Return ONLY the JSON array, no prose.

Description: """${description}"""`;

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = res.choices[0].message?.content ?? '[]';
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