import OpenAI from "openai";

export const runtime = 'nodejs';
export const maxDuration = 60; 
export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio") as File;        // .webm from the browser
  const personaPrompt = form.get("personaPrompt") as string; // system prompt
  const history = JSON.parse(String(form.get("history") || "[]")); // optional last turns

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  // 1) Speech-to-text (Whisper)
  const stt = await openai.audio.transcriptions.create({
    file: audio,
    model: "whisper-1"
  });
  const studentText = stt.text || "";

  // 2) Persona reply (system prompt + short history + user input)
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: personaPrompt },
    ...history.slice(-8), // last few exchanges keeps context small & cheap
    { role: "user", content: studentText }
  ];

  

  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.8,
    messages
  });
  const personaText = chat.choices[0].message?.content ?? "";

  return Response.json({ studentText, personaText });
  
  
  
}