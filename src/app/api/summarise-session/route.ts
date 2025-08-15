import OpenAI from "openai";

export async function POST(req: Request) {
  const { transcript } = await req.json(); // array of {who,text}
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const prompt = `Analyze this UX practice interview focusing on interviewer technique (not product).
Return JSON: {
 "key_moments": [string], 
 "missed_opportunities": [string],
 "question_type_counts": {"open":0,"closed":0,"leading":0,"double-barrel":0,"probing":0},
 "tone_shift_notes": [string],
 "tips": [string,string,string]
}
Transcript (speaker: text):
${transcript.map((t:any)=>`${t.who.toUpperCase()}: ${t.text}`).join('\n')}
`;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role: "user", content: prompt }]
  });
  const txt = res.choices[0].message?.content ?? "{}";
  const json = txt.replace(/```json|```/g, '');
  return new Response(json, { headers: { "Content-Type": "application/json" } });
}