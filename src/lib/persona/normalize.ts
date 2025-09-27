import type { PersonaSummary as PS } from "@/types/persona";

export type PersonaSummary = PS;

const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
};

export function normalizePersonaSummary(input: any): PersonaSummary {
  if (!input) return {} as PersonaSummary;

  const personality = pick(input, "personality", "tone", "style", "mood", "temperament");
  const extraInstructions = pick(input, "extraInstructions", "extra", "notes", "instructions");

  let painPoints: string[] | undefined;
  const pp = input?.painPoints ?? input?.pain_points ?? input?.painpoints;
  if (Array.isArray(pp)) {
    painPoints = pp.map((s: any) => String(s).trim()).filter(Boolean);
  } else if (typeof pp === "string") {
    painPoints = pp.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  const tech = (input?.techFamiliarity ?? input?.tech_level ?? input?.techLevel) as
    | "low"
    | "medium"
    | "high"
    | undefined;

  return {
    name: pick(input, "name", "displayName"),
    age: typeof input?.age === "number" ? input.age : Number(input?.age) || undefined,
    techFamiliarity: tech,
    personality, // do not coerce to default
    occupation: pick(input, "occupation", "role"),
    painPoints,
    extraInstructions, // do not drop free text
  } as PersonaSummary;
}

