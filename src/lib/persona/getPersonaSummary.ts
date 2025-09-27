import { supabaseServer } from "@/lib/supabase";
import { normalizePersonaSummary, type PersonaSummary } from "@/lib/persona/normalize";

function asList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  const splitter = /[\n,;]+/g;
  return String(value).split(splitter).map((s) => s.trim()).filter(Boolean);
}

function normalizeTech(value: unknown): "low" | "medium" | "high" | undefined {
  const t = String(value ?? "").toLowerCase();
  if (!t) return undefined;
  if (t.includes("high")) return "high";
  if (t.includes("low")) return "low";
  if (t.includes("medium")) return "medium";
  return undefined;
}

export async function getPersonaSummary(id: string): Promise<PersonaSummary> {
  const sb = supabaseServer();
  // First try as session id
  const { data: session } = await sb
    .from("sessions")
    .select("id, persona_id, project_id, persona_summary")
    .eq("id", id)
    .maybeSingle();

  // If the session already carries a snapshot, prefer it verbatim
  const snapshot = (session as any)?.persona_summary;
  if (snapshot && typeof snapshot === "object") {
    return normalizePersonaSummary(snapshot);
  }

  let personaId: string | null = null;
  if (session && session.persona_id) personaId = String(session.persona_id);
  if (!personaId) {
    // Treat input as a direct persona id
    personaId = id;
  }

  const { data: personaRow } = await sb
    .from("personas")
    .select(
      "id,name,age,occupation,techfamiliarity,personality,style,tone,goals,frustrations,painpoints,notes"
    )
    .eq("id", String(personaId))
    .maybeSingle();

  if (!personaRow) return {} as PersonaSummary;

  const summary: PersonaSummary = normalizePersonaSummary({
    name: personaRow.name,
    age: personaRow.age,
    techFamiliarity: normalizeTech(personaRow.techfamiliarity),
    personality: personaRow.personality ?? (personaRow as any)?.style ?? (personaRow as any)?.tone,
    occupation: personaRow.occupation,
    painPoints: asList(personaRow.painpoints ?? (personaRow as any)?.goals ?? (personaRow as any)?.frustrations),
    extraInstructions: (personaRow as any)?.notes,
  });

  return summary;
}
