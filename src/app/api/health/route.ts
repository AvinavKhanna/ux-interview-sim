import OpenAI from "openai";

export async function GET() {
  // 1) Just check that envs exist (don’t print them!)
  const hasSupabaseUrl   = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasSupabaseKey   = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasOpenAIKey     = !!process.env.OPENAI_API_KEY;

  // 2) Ping OpenAI with a tiny request (fast/cheap)
  let openaiOk = false;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    await client.models.list(); // simple “is the key valid?” check
    openaiOk = true;
  } catch (e) {
    openaiOk = false;
  }

  return Response.json({
    status: "ok",
    env: { supabaseUrl: hasSupabaseUrl, supabaseKey: hasSupabaseKey, openaiKey: hasOpenAIKey },
    openaiOk
  });
}