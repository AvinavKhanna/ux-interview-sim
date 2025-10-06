import OpenAI from "openai";

export type CoachTip = {
  label:
    | "rapport_to_specifics"
    | "open_over_closed"
    | "follow_up_opportunity"
    | "clarify_gently"
    | "deescalate_emotion"
    | "boundaries"
    | "sensitive_rationale"
    | "affirm_good_move";
  message: string;
  suggestion?: string;
  severity: "info" | "nudge" | "important";
};

type Turn = { speaker: "interviewer" | "participant"; text: string; startedAt?: number; endedAt?: number };
type CoachInput = {
  turns: Turn[];
  currentInterviewerText: string;
  personaBrief?: string;
  emotions?: Array<{ t: number; valence?: number; arousal?: number }>;
};

const SYSTEM = `
You are the COACH (not the participant). Speak as a mentor only.

STYLE
- Be BRIEF: 1 sentence for message (<= 28 words).
- Include at most 1 concrete suggested question (4–12 words) when helpful.
- Student-friendly, kind, specific. No jargon, no emojis.

HARD RULES
- Never greet back ("Great to meet you"), never chat ("okay", "sure"), never add trailing filler ("true").
- Do not role-play the participant or persona.
- No critique for greetings or early light bio (name/age) in first 5 interviewer turns or first 90s.
- Normal scoping questions ("have you used X?") are fine.
- If interviewer is rude or persona is insulted → de-escalate/boundaries guidance.
- If emotions spike (negative valence or high arousal) → acknowledge briefly, then a soft probe.
- Prefer open how/what/why over closed unless confirming.
- Output JSON ONLY in this shape: { "label": <one of: "rapport_to_specifics","open_over_closed","follow_up_opportunity","clarify_gently","deescalate_emotion","boundaries","sensitive_rationale","affirm_good_move">,
  "message": string, "suggestion"?: string, "severity": "info"|"nudge"|"important" }.
`;

function buildUser(input: CoachInput) {
  const recent = input.turns.slice(-8).map((t) => `[${t.speaker}] ${t.text}`).join("\n");
  const emo = (input.emotions || [])
    .slice(-6)
    .map((e) => `(${e.t}:${e.valence ?? 0},${e.arousal ?? 0})`)
    .join(" ");
  return `Persona: ${input.personaBrief ?? "N/A"}\nRecent turns:\n${recent}\n\nCurrent interviewer text: ${input.currentInterviewerText}\nEmotions: ${emo}\nRespond with one JSON tip only.`;
}

const apiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

export async function getCoachTip(input: CoachInput): Promise<CoachTip | null> {
  if (!client) return null;
  try {
    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUser(input) },
      ],
      max_tokens: 120,
    });
    const content = r.choices?.[0]?.message?.content ?? "{}";
    const tip = JSON.parse(content) as CoachTip;
    if (!tip?.message) return null;
    return sanitizeTip(tip);
  } catch {
    return null;
  }
}

function sanitizeTip(tip: CoachTip): CoachTip {
  const scrub = (s?: string) => (s ?? "")
    .replace(/\b(true|okay|sure)\.?\s*$/i, "")
    .replace(/^(\s*(it('|)s )?great to meet you( too)?[.!]?\s*)/i, "")
    .replace(/^(\s*nice to meet you( too)?[.!]?\s*)/i, "")
    .replace(/\s+/g, " ").trim();
  const message = scrub(tip.message);
  const suggestion = tip.suggestion ? scrub(tip.suggestion) : undefined;
  const short = (s: string, n: number) => s.split(" ").slice(0, n).join(" ");
  return { ...tip, message: short(message, 28), suggestion: suggestion ? short(suggestion, 12) : undefined };
}
