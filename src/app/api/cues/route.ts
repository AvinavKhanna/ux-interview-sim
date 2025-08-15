import OpenAI from "openai";

export async function POST(req: Request) {
  const { personaReply, studentQuestion } = await req.json();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const prompt = `You are a UX interview coaching classifier.
Student question: "${studentQuestion}"
Persona previous reply: "${personaReply}"
Return JSON with: {"question_type":"open|closed|leading|double-barrel|probing","suggestion":"8-12 words","rationale":"short reason"}`;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role: "user", content: prompt }]
  });
  const txt = res.choices[0].message?.content ?? "{}";
  return new Response(txt, { headers: { "Content-Type": "application/json" } });
}