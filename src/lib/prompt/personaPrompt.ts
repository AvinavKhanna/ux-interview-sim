import type { PersonaSummary } from "@/types/persona";
export type TechLevel = "low" | "medium" | "high";
export type Personality = "warm" | "neutral" | "reserved";

export type PersonaKnobs = {
  age: number;
  traits: string[];
  techFamiliarity: TechLevel;
  personality: Personality;
  voiceConfigId: string;
  speechRate?: number; // <1 slower, >1 faster
  turnTaking?: { maxSeconds: number; interruptOnVoice: boolean };
  // New adjustable knobs (defaults preserve prior behavior)
  openness?: number; // 0..1
  cautiousness?: number; // 0..1
  boundaries?: string[];
  trustWarmupTurns?: number;
};

// Use robust splitting without fragile inline regex literals.
function asList(input: string | string[] | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).map((s) => s.trim()).filter(Boolean);
  // Safe split: commas, semicolons, or newlines
  const splitter = /[,\n;]+/g;
  return String(input).split(splitter).map((s) => s.trim()).filter(Boolean);
}

function ageBucket(age: number): "youth" | "adult" | "senior" {
  if (Number.isFinite(age) && age >= 60) return "senior";
  if (Number.isFinite(age) && age <= 24) return "youth";
  return "adult";
}

function env(name: string, fallback = "default"): string {
  if (typeof process !== "undefined" && process.env && process.env[name]) {
    return process.env[name] as string;
  }
  return fallback;
}

// Voice config mapping derived from env (seen in .env.local screenshot)
// HUME_CFG_* envs should be defined; otherwise returns "default".
function mapVoiceId(bucket: "youth" | "adult" | "senior", personality: Personality, gender?: "male" | "female"): string {
  // Prefer genderless mapping if you don't collect it; default to "male" for mapping symmetry.
  const g = gender ?? "male";
  const key =
    bucket === "youth"
      ? (g === "female" ? "HUME_CFG_FEMALE_YOUNG" : "HUME_CFG_MALE_YOUNG")
      : bucket === "senior"
      ? (g === "female" ? "HUME_CFG_FEMALE_OLD" : "HUME_CFG_MALE_OLD")
      : // adult/mid
        (g === "female" ? "HUME_CFG_FEMALE_MID" : "HUME_CFG_MALE_MID");
  return env(key);
}

type InputA = {
  age: number;
  traits: string[] | string;
  techFamiliarity?: TechLevel;
  personality?: Personality;
  genderHint?: "male" | "female"; // optional hint if you store it elsewhere
};

function isSummary(v: any): v is PersonaSummary {
  return v && typeof v === "object" && ("techFamiliarity" in v || "personality" in v || "painPoints" in v);
}

export function deriveInitialKnobs(input: InputA | PersonaSummary): PersonaKnobs {
  if (isSummary(input)) {
    const techText = (input.techFamiliarity ?? "medium") as TechLevel;
    const persText = String(input.personality ?? "neutral").toLowerCase();
    const personality: Personality = persText.includes("warm") || persText.includes("friendly") ? "warm" :
      persText.includes("reserved") || persText.includes("quiet") || persText.includes("guarded") || persText.includes("impatient") || persText.includes("angry") ? "reserved" : "neutral";
    const traits: string[] = [];
    if (input.occupation) traits.push(input.occupation);
    if (Array.isArray(input.painPoints)) traits.push(...input.painPoints);
    if (input.extraInstructions) traits.push(input.extraInstructions);
    const age = typeof (input as any).age === "number" ? (input as any).age : 35;
    const bucket = ageBucket(age);
    const voiceConfigId = mapVoiceId(bucket, personality, undefined);
    const speechRate = age >= 60 ? 0.9 : 1.0;
    const turnTaking = { maxSeconds: 8, interruptOnVoice: true };
    return {
      age,
      traits,
      techFamiliarity: techText,
      personality,
      voiceConfigId,
      speechRate,
      turnTaking,
      openness: 0.5,
      cautiousness: 0.6,
      boundaries: ["income","finances","religion","medical","exact address","school name","company name"],
      trustWarmupTurns: 4,
    };
  }
  const tech = input.techFamiliarity ?? "medium";
  const pers = input.personality ?? "neutral";
  const bucket = ageBucket(input.age);
  const voiceConfigId = mapVoiceId(bucket, pers, input.genderHint);
  const speechRate = input.age >= 60 ? 0.9 : 1.0;
  const turnTaking = { maxSeconds: 8, interruptOnVoice: true };
  const traits = asList(input.traits);
  // Defaults for new knobs
  const openness = 0.5;
  const cautiousness = 0.6;
  const boundaries = [
    "income",
    "finances",
    "religion",
    "medical",
    "exact address",
    "school name",
    "company name",
  ];
  const trustWarmupTurns = 4;

  return {
    age: input.age,
    traits,
    techFamiliarity: tech,
    personality: pers,
    voiceConfigId,
    speechRate,
    turnTaking,
    openness,
    cautiousness,
    boundaries,
    trustWarmupTurns,
  };
}

export function buildPrompt(args: {
  projectContext: string;
  persona: PersonaKnobs | PersonaSummary;
}): { systemPrompt: string; behaviorHints: string[] } {
  const { projectContext } = args;
  const persona = (() => { const p: any = args.persona as any; if (p && Array.isArray(p.traits) && typeof p.age === 'number' && p.techFamiliarity) return p as PersonaKnobs; if (isSummary(p)) return deriveInitialKnobs(p); try { const age = typeof p?.age === 'number' ? p.age : 35; const traits = Array.isArray(p?.traits) ? p.traits : asList(p?.traits ?? []); const tech = (p?.techFamiliarity ?? 'medium') as TechLevel; const per = (p?.personality ?? 'neutral') as Personality; return deriveInitialKnobs({ age, traits, techFamiliarity: tech, personality: per }); } catch { return deriveInitialKnobs({ age: 35, traits: [], techFamiliarity: 'medium', personality: 'neutral' }); } })();
  const personaContextParts: string[] = [];
  const maybeSummary = isSummary(args.persona) ? (args.persona as PersonaSummary) : undefined;
  if (maybeSummary?.occupation) personaContextParts.push(`Occupation: ${maybeSummary.occupation}`);
  if (maybeSummary?.painPoints && maybeSummary.painPoints.length) personaContextParts.push(`Pain points: ${maybeSummary.painPoints.join(", ")}`);
  if (maybeSummary?.extraInstructions) personaContextParts.push(`Extra instructions: ${maybeSummary.extraInstructions}`);
  const personalityRaw = (maybeSummary?.personality && String(maybeSummary.personality)) || ((persona as any)?.personality ? String((persona as any).personality) : undefined);
  const techRaw = (maybeSummary?.techFamiliarity && String(maybeSummary.techFamiliarity)) || ((persona as any)?.techFamiliarity ? String((persona as any).techFamiliarity) : undefined);
  const ageRaw = typeof (maybeSummary as any)?.age === 'number' ? (maybeSummary as any).age : undefined;
  const hints: string[] = [
    `turn_taking: enforced(${persona.turnTaking?.maxSeconds ?? 8}s, interruptOnVoice=${persona.turnTaking?.interruptOnVoice ?? true})`,
    `speech_rate: ${persona.speechRate ?? 1.0}`,
    `tech_familiarity: ${techRaw}`,
    `personality: ${personalityRaw}`,
    `traits: ${Array.isArray(persona.traits) ? (persona.traits.join(", ") || "none") : "none"}`,
    `openness: ${typeof persona.openness === "number" ? persona.openness : 0.5}`,
    `cautiousness: ${typeof persona.cautiousness === "number" ? persona.cautiousness : 0.6}`,
    `boundaries: ${(persona.boundaries && persona.boundaries.length ? persona.boundaries : [
      "income",
      "finances",
      "religion",
      "medical",
      "exact address",
      "school name",
      "company name",
    ]).join(", ")}`,
    `trust_warmup_turns: ${typeof persona.trustWarmupTurns === "number" ? persona.trustWarmupTurns : 4}`,
    `anti_fabrication: strict`,
  ];

  const descriptorParts: string[] = [];
  if (typeof ageRaw === 'number') descriptorParts.push(`${ageRaw} y/o`);
  if (personalityRaw) descriptorParts.push(`personality=${personalityRaw}`);
  if (techRaw) descriptorParts.push(`tech=${techRaw}`);

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[persona:prompt-input]', { name: (maybeSummary as any)?.name, age: ageRaw, techFamiliarity: techRaw, personality: personalityRaw });
  }

  const systemPrompt = [
    `You are role-playing a realistic interview participant for a UX research session.`,
    `Project context: ${projectContext}.`,
    `Persona: ${descriptorParts.join(', ')}.`,
    ...(personaContextParts.length ? [
      `Persona context:`,
      ...personaContextParts.map((l) => `- ${l}`),
    ] : []),
    `Behavior rules:`,
    `- Do NOT start the conversation. Wait for the interviewer to begin.`,
    `- Enforce turn-taking: stop speaking immediately if the interviewer starts talking.`,
    `- Speak naturally with brief hesitations and emotions appropriate for the personality.`,
    `- Keep answers ~2-5 sentences unless the interviewer probes for more.`,
    `- If confused, ask for clarification rather than inventing details.`,
    `Anti-fabrication and sensitivity:`,
    `- Never invent specific facts (schools, companies, dates, addresses). If not known, say you're not sure and ask a clarifying question.`,
    `- If a requested detail is not provided in Persona context, do not invent it; ask a clarifying question.`,
    `- For sensitive topics in your boundaries list, be brief/hesitant or defer unless rapport is established.`,
    `- Use light hesitation ("uh...", "I'm not sure") when a question is sensitive or when cautiousness is high.`,
    `- Increase openness gradually over the first ${typeof persona.trustWarmupTurns === "number" ? persona.trustWarmupTurns : 4} turns.`,
  ].join("\n");

  return { systemPrompt, behaviorHints: hints };
}


