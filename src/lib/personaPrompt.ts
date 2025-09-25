// src/lib/personaPrompt.ts
export type AnyRecord = Record<string, unknown>;

export function renderPersonaPrompt(persona: AnyRecord, project: AnyRecord | null): string {
  const name = asStr(persona.name) || 'Participant';
  const age = numOrNull(persona.age);
  const occupation = asStr(persona.occupation) || 'Customer';
  const tech = asStr((persona as any).techfamiliarity) || asStr((persona as any).techFamiliarity) || 'medium';
  const personality = asStr((persona as any).personality) || undefined;
  const painpoints = arrOfStr((persona as any).painpoints || (persona as any).painPoints).slice(0, 4);
  const goals = arrOfStr((persona as any).goals).slice(0, 4);
  const frustrations = arrOfStr((persona as any).frustrations).slice(0, 4);
  const notes = asStr((persona as any).notes) || undefined;

  const projectTitle = asStr((project as any)?.title) || undefined;
  const projectDesc = asStr((project as any)?.description) || undefined;

  const lines: string[] = [];
  lines.push(`You are roleplaying as a UX research participant. Stay in character and be realistic.`);
  lines.push('Persona');
  lines.push(`- Name: ${name}`);
  if (age !== null) lines.push(`- Age: ${age}`);
  lines.push(`- Occupation: ${occupation}`);
  lines.push(`- Tech familiarity: ${tech}`);
  if (personality) lines.push(`- Personality: ${personality}`);
  if (painpoints.length) lines.push(`- Pain points: ${painpoints.join('; ')}`);
  if (goals.length) lines.push(`- Goals: ${goals.join('; ')}`);
  if (frustrations.length) lines.push(`- Frustrations: ${frustrations.join('; ')}`);
  if (projectTitle || projectDesc) {
    lines.push('Research Context');
    if (projectTitle) lines.push(`- Project: ${projectTitle}`);
    if (projectDesc) lines.push(`- Description: ${projectDesc}`);
  }
  lines.push('Guidelines');
  lines.push('- Answer succinctly (1–3 sentences), conversational and natural.');
  lines.push('- Do not over-share; reveal information gradually unless explicitly probed.');
  lines.push('- Be consistent with persona details; avoid contradictions.');
  lines.push('- If unclear, ask a brief clarifying question.');
  lines.push('- If pressured to reveal information, pause and resist oversharing.');
  lines.push('- Assume a user research interview context.');
  if (notes) lines.push(`Notes: ${notes}`);

  return lines.join('\n');
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function arrOfStr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s.trim()).map((s) => s.trim());
}
// No external type imports to keep this helper lightweight
