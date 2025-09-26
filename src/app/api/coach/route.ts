import { NextResponse } from "next/server";
import type { CoachSample, CoachResponse, CoachPolicy, CoachHint } from "@/types/coach";
import { DefaultCoachPolicy } from "@/types/coach";

export const dynamic = "force-dynamic";

type SessionCounters = {
  lastHintAt: number;
  windowStart: number;
  countInWindow: number;
};

const counters = new Map<string, SessionCounters>();

function resolveSessionId(req: Request): string {
  const h = req.headers.get("x-session-id");
  if (h && h.trim()) return h.trim();
  const ref = req.headers.get("referer") || req.headers.get("referrer") || "";
  const m = /\/sessions\/([0-9a-fA-F\-]{8,})/.exec(ref);
  if (m && m[1]) return m[1];
  return "anon";
}

function blockedByPolicy(sessionId: string, policy: CoachPolicy): boolean {
  const now = Date.now();
  const c = counters.get(sessionId) || { lastHintAt: 0, windowStart: now, countInWindow: 0 };
  if (now - c.lastHintAt < policy.minGapMs) return true;
  if (now - c.windowStart > 60_000) {
    c.windowStart = now;
    c.countInWindow = 0;
  }
  if (c.countInWindow >= policy.maxHintsPerMinute) return true;
  return false;
}

function noteHint(sessionId: string) {
  const now = Date.now();
  const c = counters.get(sessionId) || { lastHintAt: 0, windowStart: now, countInWindow: 0 };
  if (now - c.windowStart > 60_000) {
    c.windowStart = now;
    c.countInWindow = 0;
  }
  c.lastHintAt = now;
  c.countInWindow += 1;
  counters.set(sessionId, c);
}

function isGreeting(q: string, policy: CoachPolicy): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (s.split(/\s+/).length < 3) return true;
  return policy.ignorePhrases.some((p) => s === p || s.startsWith(p + " "));
}

function last(strs: string[], n: number): string[] {
  const a = Array.isArray(strs) ? strs.filter(Boolean) : [];
  return a.slice(Math.max(0, a.length - n));
}

function heuristicCoach(sample: CoachSample, policy: CoachPolicy): CoachHint | null {
  const q = (sample.question || "").trim();
  const s = q.toLowerCase();
  if (isGreeting(q, policy)) return null;

  // boundary check
  const sensitive = /(income|salary|address|medical|religion|school|company)/.test(s);
  const specific = /(which|what|where|who)/.test(s);
  if (sensitive && specific) {
    return { kind: "boundary", text: "Avoid asking for specific personal details. Reframe more generally or defer." };
  }

  // clarify check (leading or double question)
  if (/don\'t you think|wouldn\'t you say/.test(s) || /\?\s*and\s+/.test(q)) {
    return { kind: "clarify", text: "Try neutral, single-part questions. Avoid leading phrasing." };
  }

  // praise for good openers
  if (/^(how|what)\b/.test(s) || s.startsWith("can you tell me about") || s.startsWith("describe")) {
    return { kind: "praise", text: "Nice open-ended question. Give space and follow up gently." };
  }

  // probe if last assistant answer was short and question was open-ended
  const lastAssist = last(sample.lastAssistTurns || [], 1)[0] || "";
  const shortAssist = lastAssist.trim().length > 0 && lastAssist.trim().length < 80;
  const openEnded = /\b(how|why|what|tell me about|describe)\b/.test(s);
  if (shortAssist && openEnded) {
    return { kind: "probe", text: "Consider a soft probe like: 'Could you share a bit more about that?'" };
  }

  // rapport (default nudge)
  if (/\bthank\b|\bthanks\b/.test(s)) {
    return { kind: "rapport", text: "Acknowledge and keep the tone warm; reflect back briefly." };
  }

  return null;
}

async function maybeLLM(sample: CoachSample): Promise<CoachHint | null> {
  // Optional LLM path; only if explicitly enabled and credentials exist.
  try {
    if (process.env.COACH_USE_LLM !== "1") return null;
    const key = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (!key) return null;
    const content = `You are an interview coach. Read the interviewer question and context. Reply with one short hint (<= 18 words) prefixed by one of [probe|praise|boundary|clarify|rapport]:\nQuestion: ${sample.question}\nLastUser: ${(sample.lastUserTurns || []).join(" | ")}\nLastAssist: ${(sample.lastAssistTurns || []).join(" | ")}`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content }] }),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    const text: string = data?.choices?.[0]?.message?.content || "";
    const m = /^(probe|praise|boundary|clarify|rapport)\s*:\s*(.+)/i.exec(text);
    if (m) {
      const kind = m[1].toLowerCase() as CoachHint["kind"];
      return { kind, text: m[2].trim() };
    }
    // default to praise-style nudge
    if (text.trim()) return { kind: "praise", text: text.trim().slice(0, 120) };
  } catch {}
  return null;
}

export async function POST(req: Request) {
  const sessionId = resolveSessionId(req);
  const policy = DefaultCoachPolicy;
  try {
    const sample = (await req.json().catch(() => ({}))) as CoachSample | any;
    const q = String(sample?.question ?? "");
    if (!q.trim()) return NextResponse.json({ hints: [] } satisfies CoachResponse);
    if (blockedByPolicy(sessionId, policy)) return NextResponse.json({ hints: [] } satisfies CoachResponse);

    let hint: CoachHint | null = null;
    // Optional LLM path first
    hint = await maybeLLM(sample);
    if (!hint) hint = heuristicCoach(sample, policy);

    if (hint) {
      noteHint(sessionId);
      return NextResponse.json({ hints: [hint] } satisfies CoachResponse);
    }
    return NextResponse.json({ hints: [] } satisfies CoachResponse);
  } catch (err) {
    return NextResponse.json({ hints: [] } satisfies CoachResponse, { status: 200 });
  }
}

