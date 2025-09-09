import OpenAI from "openai";

export const runtime = "nodejs";

type Turn = { who: string; text: string };

type SummaryJSON = {
  key_moments: string[];
  missed_opportunities: string[];
  question_type_counts: {
    open: number;
    closed: number;
    leading: number;
    "double-barrel": number;
    probing: number;
  };
  tone_shift_notes: string[];
  tips: string[];
};

function stripCodeFences(s: string) {
  return s.replace(/```json|```/g, "").trim();
}

function sanitizeTranscript(input: unknown): Turn[] {
  if (!Array.isArray(input)) return [];
  const rows = input
    .map((t) => {
      const who = typeof t?.who === "string" ? t.who : "";
      const text = typeof t?.text === "string" ? t.text : "";
      return { who: who.slice(0, 40), text: text.slice(0, 2000) };
    })
    .filter((t) => t.who && t.text);

  // Keep the last N lines to keep prompts small
  const MAX_TURNS = 200;
  return rows.slice(-MAX_TURNS);
}

const EMPTY_COUNTS = {
  open: 0,
  closed: 0,
  leading: 0,
  "double-barrel": 0,
  probing: 0,
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const transcript = sanitizeTranscript(body?.transcript);

    if (transcript.length === 0) {
      return new Response(JSON.stringify({ error: "transcript is required" }), {
        status: 400,
      });
    }

    const formatted = transcript
      .map((t) => `${t.who.toUpperCase()}: ${t.text}`)
      .join("\n");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const prompt = `Analyze this UX PRACTICE INTERVIEW focusing on the INTERVIEWER'S TECHNIQUE only (not the product).
Return ONLY valid JSON with this EXACT shape and keys:

{
 "key_moments": [string],
 "missed_opportunities": [string],
 "question_type_counts": {"open":0,"closed":0,"leading":0,"double-barrel":0,"probing":0},
 "tone_shift_notes": [string],
 "tips": [string, string, string]
}

Notes:
- Keep arrays concise (max 6 items each except tips = exactly 3).
- "question_type_counts" should reflect the interviewer turns only.
- No prose outside JSON.

Transcript (speaker: text):
${formatted}
`;

    const res = await openai.chat.completions.create({
      model: "gpt-5",
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = res.choices[0]?.message?.content ?? "{}";
    const cleaned = stripCodeFences(raw);

    let parsed: Partial<SummaryJSON>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: "Model did not return valid JSON", raw: cleaned }),
        { status: 502 }
      );
    }

    // Defensive normalization
    const safe: SummaryJSON = {
      key_moments: Array.isArray(parsed.key_moments)
        ? parsed.key_moments.slice(0, 6).map(String)
        : [],
      missed_opportunities: Array.isArray(parsed.missed_opportunities)
        ? parsed.missed_opportunities.slice(0, 6).map(String)
        : [],
      question_type_counts: {
        ...EMPTY_COUNTS,
        ...(parsed.question_type_counts ?? {}),
      } as SummaryJSON["question_type_counts"],
      tone_shift_notes: Array.isArray(parsed.tone_shift_notes)
        ? parsed.tone_shift_notes.slice(0, 6).map(String)
        : [],
      tips: Array.isArray(parsed.tips)
        ? parsed.tips.slice(0, 3).map(String)
        : [],
    };

    return new Response(JSON.stringify(safe), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message ?? "Server error" }),
      { status: 500 }
    );
  }
}