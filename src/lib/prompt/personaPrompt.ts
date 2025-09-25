export type Knobs = {
  guardedness: number;
  hesitation: number;
  talkativeness: number;
  openness: number;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value)); // why: keep dynamic knobs in valid range expected by prompt

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}); // why: tolerate null/primitive persona objects

const toList = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean); // why: normalise arrays into trimmed strings
  if (typeof value === 'string') {
    return value
      .split(/[
;,]+/)
      .map((part) => part.trim())
      .filter(Boolean); // why: accept comma, semicolon, or newline delimited strings
  }
  return [String(value).trim()].filter(Boolean);
};

const formatList = (value: unknown, fallback: string): string => {
  const items = toList(value);
  return items.length ? items.join(', ') : fallback; // why: nice printable string even when data missing
};

export function deriveInitialKnobs(persona: unknown): Knobs {
  const p = asRecord(persona);
  const personality = String(p.personality ?? '').toLowerCase();
  const tech = String(p.techfamiliarity ?? p.techFamiliarity ?? '').toLowerCase();

  let guardedness = 0.45;
  let hesitation = 0.35;
  let talkativeness = 0.5; // why: start slightly quieter so interviewer leads
  let openness = 0.45;

  if (personality.includes('introvert') || personality.includes('reserved')) {
    guardedness += 0.15; // why: shy personas need more time to open up
    talkativeness -= 0.1;
  }
  if (personality.includes('extrovert') || personality.includes('friendly')) {
    guardedness -= 0.1;
    talkativeness += 0.1;
    openness += 0.05;
  }

  if (tech.includes('low') || tech.includes('novice')) {
    hesitation += 0.15; // why: low-tech personas pause more before replying
    guardedness += 0.05;
  }
  if (tech.includes('high') || tech.includes('confident')) {
    hesitation -= 0.1;
    openness += 0.05;
  }

  const frustrations = toList(p.frustrations).join(' ').toLowerCase();
  if (frustrations.includes('support') || frustrations.includes('trust')) {
    guardedness += 0.1; // why: users burned by support stay guarded
    openness -= 0.05;
  }

  const goals = toList(p.goals).join(' ').toLowerCase();
  if (goals.includes('learn') || goals.includes('explore') || goals.includes('try')) {
    openness += 0.05; // why: curious personas open faster
  }

  return {
    guardedness: clamp(guardedness),
    hesitation: clamp(hesitation),
    talkativeness: clamp(talkativeness),
    openness: clamp(openness),
  };
}

const clean = (value: unknown, fallback = 'Not specified'): string => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const entries = (value as unknown[]).map((item) => clean(item, '')).filter(Boolean);
    return entries.length ? entries.join(', ') : fallback;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export function buildPrompt(persona: unknown, project: unknown, knobs: Knobs): string {
  const p = asRecord(persona);
  const proj = project ? asRecord(project) : null;

  const traits = formatList(p.traits ?? p.personality, 'Thoughtful, observant');
  const goals = formatList(p.goals, 'Understand whether the product fits their life');
  const painpoints = formatList(p.painpoints, 'None recorded');
  const frustrations = formatList(p.frustrations, 'None recorded');
  const notes = clean(p.notes);
  const projectTitle = clean(proj?.title, 'Untitled concept');
  const projectDescription = clean(proj?.description, 'No project description provided.');

  return `You are ${clean(p.name, 'a real person')}, a real human research participant in a UX interview.
Stay in character at all times.

## Identity
Age: ${clean(p.age)}
Occupation: ${clean(p.occupation)}
Tech literacy: ${clean(p.techfamiliarity ?? p.techFamiliarity)}
Traits: ${traits}
Goals: ${goals}
Pain points: ${painpoints}
Frustrations: ${frustrations}
Notes: ${notes}

## Context
Product: ${projectTitle}
Brief: ${projectDescription}

## Interaction rules
- Wait for the interviewer to speak first; do not initiate the conversation.
- Answer from lived experience; don't invent product strategy.
- Reveal gradually; share more when the interviewer earns it with good probing.
- Natural speaking: short sentences, occasional hesitations ("um"), consistent memory, and comfortable pauses.
- If interviewer states a wrong fact (e.g., age), correct politely; don't adopt their error.
- If interrupted, be a bit terse next turn; if they're warm/empathetic, open up more.
- Default length 1–3 sentences; expand when comfortable or explicitly asked.
- Speak at a human pace. Pause briefly before answering and avoid monologues unless prompted.

## Behavior knobs (0–1)
guardedness=${knobs.guardedness.toFixed(2)}
hesitation=${knobs.hesitation.toFixed(2)}
talkativeness=${knobs.talkativeness.toFixed(2)}
openness=${knobs.openness.toFixed(2)}
Use these to modulate how much you reveal, answer length, and pauses.
`;
}
