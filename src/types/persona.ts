export type PersonaSummary = {
  name?: string;
  age?: number;
  techFamiliarity?: "low" | "medium" | "high";
  personality?: string; // free text (e.g., "Impatient")
  occupation?: string;
  painPoints?: string[];
  extraInstructions?: string;
};

function asList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  const splitter = /[\n,;]+/g;
  return String(value).split(splitter).map((s) => s.trim()).filter(Boolean);
}

export function ensurePersonaSummary(input: any): PersonaSummary {
  const out: PersonaSummary = {};
  const get = (k: string) => (input && typeof input === "object" ? (input as any)[k] : undefined);

  const name = get("name");
  if (typeof name === "string" && name.trim()) out.name = name.trim();

  const age = get("age");
  if (typeof age === "number" && Number.isFinite(age)) out.age = age;

  const techRaw = get("techFamiliarity") ?? get("techfamiliarity") ?? get("tech_level") ?? get("techLevel");
  if (typeof techRaw === "string") {
    const t = techRaw.toLowerCase();
    out.techFamiliarity = t.includes("high") ? "high" : t.includes("low") ? "low" : t.includes("medium") ? "medium" : undefined;
  }

  const personality = get("personality") ?? get("style") ?? get("tone");
  if (typeof personality === "string" && personality.trim()) out.personality = personality.trim();

  const occupation = get("occupation");
  if (typeof occupation === "string" && occupation.trim()) out.occupation = occupation.trim();

  const pain = get("painPoints") ?? get("painpoints") ?? get("pains") ?? get("pain_points");
  const painList = asList(pain);
  if (painList.length) out.painPoints = painList;

  const extra = get("extraInstructions") ?? get("notes") ?? get("instructions");
  if (typeof extra === "string" && extra.trim()) out.extraInstructions = extra.trim();

  return out;
}

