import OpenAI from "openai";

export const runtime = "nodejs";

type CueJSON = {
  question_type: "open" | "closed" | "leading" | "double-barrel" | "probing";
  suggestion: string;
  rationale: string;
};

const ALLOWED_TYPES = new Set([
  "open",
  "closed",
  "leading",
  "double-barrel",
  "probing",
]);

function stripCodeFences(s: string) {
  return s.replace(/```json|```/g, "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { personaReply, studentQuestion } = body ?? {};

    if (typeof studentQuestion !== "string" || typeof personaReply !== "string") {
      return new Response(
        JSON.stringify({ error: "studentQuestion and personaReply must be strings" }),
        { status: 400 }
      );
    }

    // Simple length guards to avoid accidentally sending a novel
    const sr = studentQuestion.slice(0, 800);
    const pr = personaReply.slice(0, 1200);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const prompt = `You are a strict JSON-only classifier for UX interview technique.
Given the student's latest question and the persona's previous reply, classify the question and suggest a brief coaching cue.

Return ONLY valid JSON matching exactly:
{
  "question_type":"open|closed|leading|double-barrel|probing",
  "suggestion":"8-12 words",
  "rationale":"short reason"
}

Student question: "${sr}"
Persona previous reply: "${pr}"`;

    const res = await openai.chat.completions.create({
      model: "gpt-5",
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = res.choices[0]?.message?.content ?? "{}";
    const cleaned = stripCodeFences(raw);

    let parsed: Partial<CueJSON>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: "Model did not return valid JSON", raw: cleaned }),
        { status: 502 }
      );
    }

    // Coerce/validate fields
    const question_type = (typeof parsed.question_type === "string"
      ? parsed.question_type.toLowerCase()
      : "open") as CueJSON["question_type"];

    const safe: CueJSON = {
      question_type: (ALLOWED_TYPES.has(question_type)
        ? question_type
        : "open") as CueJSON["question_type"],
      suggestion:
        typeof parsed.suggestion === "string" && parsed.suggestion.trim()
          ? parsed.suggestion.trim().slice(0, 160)
          : "Try an open, neutral follow-up.",
      rationale:
        typeof parsed.rationale === "string" && parsed.rationale.trim()
          ? parsed.rationale.trim().slice(0, 200)
          : "Open questions encourage fuller, less biased answers.",
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