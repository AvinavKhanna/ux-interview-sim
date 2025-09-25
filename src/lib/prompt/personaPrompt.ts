export type MaybeList = string | string[] | null | undefined;

/** Normalize possibly-delimited strings into a clean array. */
export function toArray(value: MaybeList): string[] {
  if (value == null) return [];
  const asList = Array.isArray(value) ? value : [value];

  return asList
    .map(String)
    .flatMap((s) => s.split(/[,
;]+/)) // accept commas, newlines, semicolons
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Small summary string for prompts / UI. */
export function summarizePersona(p: {
  name?: string;
  age?: number;
  occupation?: string;
  techfamiliarity?: string;
  traits?: MaybeList;
  painpoints?: MaybeList;
}): string {
  const traits = toArray(p.traits).join(', ');
  const pains = toArray(p.painpoints).join(', ');
  const tech = (p.techfamiliarity || 'medium').toString().toLowerCase();

  return [
    p.name ? `Name: ${p.name}` : null,
    p.age ? `Age: ${p.age}` : null,
    p.occupation ? `Occupation: ${p.occupation}` : null,
    `Tech: ${tech}`,
    traits ? `Traits: ${traits}` : null,
    pains ? `Pain points: ${pains}` : null,
  ]
    .filter(Boolean)
    .join(' - ');
}

/** Knobs type kept for compatibility with callers. */
export type Knobs = {
  speakingRate?: number;
  bargeIn?: boolean;
  minUserSilenceMs?: number;
  maxAssistantUtteranceMs?: number;
  assistantBackoffMs?: number;
};

/** Return safe defaults if callers still expect knobs. */
export function deriveInitialKnobs(): Knobs {
  return {
    speakingRate: 0.92,        // slightly slower
    bargeIn: false,            // don't talk over the user
    minUserSilenceMs: 700,     // wait before taking the turn
    maxAssistantUtteranceMs: 6500,
    assistantBackoffMs: 900,
  };
}

/**
 * Build a system prompt string for Hume EVI (or any LLM),
 * instructing strict turn-taking and persona behavior.
 * Return shape matches what /api/hume/token expects ({ systemPrompt }).
 */
export function buildPrompt(opts: {
  persona?: {
    name?: string;
    age?: number;
    occupation?: string;
    techfamiliarity?: string;
    traits?: MaybeList;
    painpoints?: MaybeList;
  };
  project?: { title?: string; description?: string };
}): { systemPrompt: string } {
  const p = opts.persona ?? {};
  const summary = summarizePersona(p);
  const projTitle = opts.project?.title || 'Untitled project';
  const projDesc = (opts.project?.description || '').trim();

  const systemPrompt = [
    `You are role-playing a UX research PARTICIPANT.`,
    `Stay strictly in character. Be natural, human, and consistent with this profile: ${summary || 'Anonymous participant'}.`,
    `Context: ${projTitle}${projDesc ? ` - ${projDesc}` : ''}.`,
    `Turn-taking rules:`,
    `- Do NOT start the conversation. Wait for the interviewer to speak first.`,
    `- Speak one utterance at a time, then pause and wait for the interviewer.`,
    `- If interrupted, stop and yield immediately.`,
    `- Use everyday speech patterns: short sentences, occasional hesitations, emotion aligned with persona traits.`,
    `- If asked for age/name, use the persona's values; don't change these mid-session.`,
  ].join('\n');

  return { systemPrompt };
}