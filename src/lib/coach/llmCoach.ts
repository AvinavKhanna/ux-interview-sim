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

const SYSTEM = `You are a senior UX research mentor. Be brief (1–2 sentences), kind, and actionable. Give one concrete suggested question when helpful.
- No critique for greetings or early light bio (name/age) in the first minute or first 5 interviewer turns.
- Normal scoping (“have you used X before?”) is fine.
- Rudeness/insults → advise de-escalation/boundaries.
- If emotions spike (negative valence or high arousal), acknowledge first, then a soft probe.
- Prefer open how/what/why over closed unless confirming.
Return JSON: {label,message,suggestion?,severity}.`;

function buildUser(input: CoachInput) {
  const recent = input.turns
    .slice(-8)
    .map((t) => `[${t.speaker}] ${t.text}`)
    .join("\n");
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
    });
    const content = r.choices?.[0]?.message?.content ?? "{}";
    const tip = JSON.parse(content);
    return tip?.message ? (tip as CoachTip) : null;
  } catch {
    return null;
  }
}

