// src/app/api/interview/route.ts
import OpenAI from "openai";
import { toFile } from "openai/uploads";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const blob = form.get("audio") as Blob | File | null;

    if (!blob) {
      return new Response(JSON.stringify({ error: "no audio" }), { status: 400 });
    }

    // Quietly ignore microscopic clips produced by VAD edges
    if (blob.size < 12_000) {
      return new Response(null, { status: 204 });
    }

    // Ensure OpenAI receives a proper file with a filename & type
    const filename =
      (blob as any)?.name ||
      `segment.${(blob.type || "audio/webm").includes("webm") ? "webm" : "wav"}`;

    const file = await toFile(blob, filename);

    const tr = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      // language: "en", // optional
    });

    const text = (tr as any)?.text?.trim?.() || "";
    if (!text) return new Response(null, { status: 204 });

    return new Response(JSON.stringify({ text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    const msg = err?.error?.message || err?.message || "Transcription failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}