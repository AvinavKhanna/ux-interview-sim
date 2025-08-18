import type { Persona as PersonaType, TechLevel, Personality } from '@/types';

const TECHS: TechLevel[] = ['low', 'medium', 'high'];
const PERSONAS: Personality[] = ['friendly', 'guarded', 'analytical', 'impatient'];

// Accept booleans too (true → high, false → low)
function asTech(v: any): TechLevel {
  if (typeof v === 'boolean') return v ? 'high' : 'low';
  const s = String(v || '').toLowerCase();
  return (TECHS.includes(s as TechLevel) ? (s as TechLevel) : 'medium');
}
function asPersonality(v: any): Personality {
  const s = String(v || '').toLowerCase();
  return (PERSONAS.includes(s as Personality) ? (s as Personality) : 'friendly');
}

// Heuristic fallback if occupation missing
function guessOccupation(raw: any, description?: string): string {
  const demographics = (raw && typeof raw.demographics === 'object') ? raw.demographics : {};
  const traits = (raw && typeof raw.traits === 'object') ? raw.traits : {};
  const edu = String(demographics?.education || traits?.education || '').toLowerCase();
  const roleish = String(traits?.role || traits?.jobTitle || '').trim();

  if (edu.includes('student')) return 'University student';
  if (Number.isFinite(demographics?.age) && Number(demographics.age) < 21) return 'Student';

  const desc = String(description || '').toLowerCase();
  if (desc.includes('bank') || desc.includes('finance')) return 'Young professional';
  if (desc.includes('retail') || desc.includes('store') || desc.includes('shop')) return 'Retail associate';
  if (roleish) return roleish;

  return 'Participant';
}

/**
 * Map OpenAI suggestions to your canonical Persona shape.
 * Pass the project description as the 2nd arg so we can guess occupations when missing.
 */
export function mapSuggestionsToPersonas(suggestions: any[], description?: string): PersonaType[] {
  if (!Array.isArray(suggestions)) return [];
  const now = new Date().toISOString();

  return suggestions.slice(0, 6).map((raw, idx) => {
    const name = String(raw?.name ?? 'Persona');
    const demographics = typeof raw?.demographics === 'object' && raw?.demographics ? raw.demographics : {};
    const traits = typeof raw?.traits === 'object' && raw?.traits ? raw.traits : {};

    const age =
      Number.isFinite(demographics?.age) ? Number(demographics.age) :
      Number.isFinite(traits?.age) ? Number(traits.age) :
      32;

    const occupation = String(
      raw?.occupation ??
      demographics?.occupation ??
      traits?.occupation ??
      guessOccupation(raw, description)
    );

    // allow boolean techSavvy → high/low, strings still respected
    const techFamiliarity = asTech(
      raw?.techFamiliarity ??
      traits?.techFamiliarity ??
      traits?.techSavvy ??               // many models output this
      demographics?.tech
    );

    const personality = asPersonality(raw?.personality ?? traits?.personality);

    const painPointsArr: string[] = Array.isArray(raw?.painPoints) ? raw.painPoints : [];
    const painPoints =
      painPointsArr.length ? painPointsArr :
      (typeof raw?.frustrations === 'string' ? [raw.frustrations] : []);

    const persona: PersonaType = {
      id: `sugg-${idx}-${Date.now()}`,
      name,
      age,
      occupation,
      techFamiliarity,
      personality,
      painPoints,
      demographics: typeof raw?.demographics === 'object' ? raw.demographics : undefined,
      goals: typeof raw?.goals === 'string' ? raw.goals : undefined,
      frustrations: typeof raw?.frustrations === 'string' ? raw.frustrations : undefined,
      notes: typeof raw?.notes === 'string' ? raw.notes : undefined,
      created_at: now,
    };

    return persona;
  });
}