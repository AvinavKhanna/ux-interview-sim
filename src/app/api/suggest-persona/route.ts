import OpenAI from "openai";

export async function POST(req: Request) {
  const { description } = await req.json();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const prompt = `Given this UX project description, suggest 3 realistic interview personas as valid JSON array.
Each item: { "name": string, "demographics": object, "traits": object, "goals": string, "frustrations": string }.
Description: """${description}"""`;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }]
  });
  const text = res.choices[0].message?.content ?? "[]";
  // if the model returns code fences, strip them:
  const json = text.replace(/```json|```/g, '');
  return new Response(json, { headers: { "Content-Type": "application/json" } });
}