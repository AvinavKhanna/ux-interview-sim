import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { CHAT_MODEL } from '@/lib/models';
import { supabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';

function capHistory(
  items: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxItems = 14
) {
  if (!items?.length) return [];
  return items.slice(Math.max(0, items.length - maxItems));
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const userText: string = (payload.userText || '').trim();
    const sessionId: string = String(payload.sessionId || '').trim();
    if (!userText || !sessionId) {
      return NextResponse.json({ error: 'userText and sessionId are required' }, { status: 400 });
    }

    // 1) Load session, persona, and recent turns
    const sb = supabaseServer();
    const { data: session } = await sb
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    const personaId = (session as any)?.persona_id ?? (session as any)?.personaId ?? null;
    const sessionSummary = (session as any)?.summary || (session as any)?.feedback?.summary || '';

    const { data: persona } = await sb
      .from('personas')
      .select('system_prompt, name, age, occupation, techfamiliarity, painpoints, personality, demographics, notes')
      .eq('id', personaId)
      .single();

    const { data: turns } = await sb
      .from('turns')
      .select('role, text, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(20);

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = (turns || [])
      .filter((t) => t.text && t.text.trim().length)
      .map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', content: t.text! }));

    console.log('[reply] persona', { id: personaId, name: (persona as any)?.name });

    // 2) Build persona context + prompt
    const demo = (persona as any)?.demographics || {};
    const facts: string[] = [];
    if ((persona as any)?.name) facts.push(`Name: ${(persona as any).name}`);
    if ((persona as any)?.age) facts.push(`Age: ${(persona as any).age}`);
    if (demo.location) facts.push(`Location: ${demo.location}`);
    if ((persona as any)?.occupation) facts.push(`Occupation: ${(persona as any).occupation}`);
    if ((persona as any)?.techfamiliarity) facts.push(`Tech familiarity: ${(persona as any).techfamiliarity}`);
    if ((persona as any)?.personality) facts.push(`Personality: ${(persona as any).personality}`);
    if (Array.isArray((persona as any)?.painpoints) && (persona as any).painpoints.length) {
      facts.push(`Pain points: ${((persona as any).painpoints as string[]).join('; ')}`);
    }
    if ((persona as any)?.notes) facts.push(`Notes: ${(persona as any).notes}`);
    const personaContext = facts.join('\n');

    const derivedPrompt = `You are roleplaying as a UX interview participant. Stay in character.
Persona summary:
${personaContext || 'N/A'}

Rules:
- Answer naturally in 1â€“3 concise sentences.
- Do not over-disclose information unless specifically probed.
- Maintain consistency with the persona summary; avoid contradictions.
- If unclear, ask one brief clarifying question first.`;

    const personaPrompt = (persona as any)?.system_prompt && String((persona as any).system_prompt).trim()
      ? String((persona as any).system_prompt)
      : derivedPrompt;

    // Derive attitude rules to reflect persona realism dynamically
    const personalityLower = String((persona as any)?.personality || '').toLowerCase();
    const isImpatient = personalityLower.includes('impatient') || personalityLower.includes('short-tempered');
    const isFriendly = personalityLower.includes('friendly') || personalityLower.includes('warm');
    const isAngry = personalityLower.includes('angry') || personalityLower.includes('always angry');
    const isGuarded = personalityLower.includes('guarded') || personalityLower.includes('reserved');
    const isAnalytical = personalityLower.includes('analytical');
    const attitudeRules = [
      isImpatient && `Impatient behavior: keep answers short (1-2 sentences), slightly rushed. If the question is long-winded or repetitive, you may ask once: "How much longer?"`,
      isFriendly && `Friendly behavior: use warm, collaborative tone. Occasionally ask one short question back to build rapport (e.g., "Does that help?", "Would you like an example?").`,
      isAngry && `Angry behavior: remain curt and irritated. If the interviewer uses disrespectful language (swearing or an aggressive tone), state a boundary and consider ending the interview (e.g., "I don't feel comfortable continuing.").`,
    ].filter(Boolean).join('\n');

    // Phase-aware disclosure settings derived from current turn count
    const userTurnCount = history.filter((h) => h.role === 'user').length;
    const assistantTurnCount = history.filter((h) => h.role === 'assistant').length;
    const isFirstPersonaReply = assistantTurnCount === 0;
    const phase = userTurnCount <= 3 ? 'early' : userTurnCount <= 8 ? 'mid' : 'late';
    const baseMax = isImpatient ? 2 : isFriendly ? 3 : isGuarded ? 1 : 2;
    const maxSentences = phase === 'early' ? Math.min(2, baseMax) : phase === 'mid' ? Math.min(3, baseMax + 1) : Math.min(4, baseMax + 2);
    const phaseRules = `Current phase: ${phase}. Keep replies to <= ${maxSentences} sentences. Do not volunteer extra information in early phase; prefer a brief clarifying question if the question is broad. Avoid sharing sensitive details (income, finances, religion, medical, addresses, exact schools/companies) unless asked directly after rapport is established.`;

    // Intensity blending: hold personality shape at runtime
    const impatientLevel = isImpatient ? 1 : 0;
    const guardedLevel = isGuarded ? 1 : 0;
    const angryAlways = /\balways angry\b/.test(personalityLower);
    const negMood = Math.max(angryAlways ? 0.7 : 0, impatientLevel, guardedLevel);
    const trustWarm = typeof (persona as any)?.trustWarmupTurns === 'number' ? (persona as any).trustWarmupTurns : 4;
    const rapportBase = Math.max(0, userTurnCount - 1) / Math.max(1, (trustWarm as number) + 4);

    // Tone detection over recent user turns (decays naturally over 2-3 turns)
    const recentUsers = [...history.filter((h) => h.role === 'user').map((h) => h.content), userText].slice(-3);
    const isFriendlyTone = (s: string) => /\b(please|thanks|thank you|appreciate|great question|good question|cheers|nice)\b/i.test(s);
    const isCalmEncouraging = (s: string) => /\b(take your time|no rush|that helps|i see|makes sense)\b/i.test(s);
    const isRudeTone = (s: string) => /(\bfuck\b|\bshit\b|\bstupid\b|\bidiot\b|\bdumb\b|\bwtf\b|\bcalm down\b|\bthat'?s dumb\b|\banswer (now|me)\b|\bhurry up\b|\bnonsense\b)/i.test(s);
    const isImpatientTone = (s: string) => /\b(quickly|real quick|just answer|come on)\b/i.test(s);
    const isDismissiveAggressive = (s: string) => /\b(whatever|don'?t care|useless|pointless)\b/i.test(s);
    const toneFriendlyScore = recentUsers.reduce((n, s) => n + (isFriendlyTone(s) || isCalmEncouraging(s) ? 1 : 0), 0) / Math.max(1, recentUsers.length);
    const toneRudeScore = recentUsers.reduce((n, s) => n + (isRudeTone(s) || isImpatientTone(s) || isDismissiveAggressive(s) ? 1 : 0), 0) / Math.max(1, recentUsers.length);

    // Rapport with smoothing and tone effects (one rude line wonâ€™t fully reset trust)
    let rapport = Math.min(1, Math.max(0, rapportBase + 0.15 * toneFriendlyScore - 0.10 * toneRudeScore));
    // Hold personality influence longer: ramp rapport effect over ~6 user turns
    const rapportRamp = Math.min(1, Math.max(0, (userTurnCount - 1) / 5));
    const effectiveRapport = Math.min(1, Math.max(0, rapport) * rapportRamp);
    const easing = 1 - Math.min(0.8, Math.max(0, effectiveRapport));

    // Baseline runtime shape
    let directness = Math.max(0.0, 0.6 * negMood);
    const baseTokens = Math.max(40, maxSentences * 30);
    let targetTokens = Math.max(24, Math.round(baseTokens * (1 - 0.35 * negMood * easing)));
    let elaboration = Math.max(0.2, (0.6) * (1 - 0.4 * impatientLevel * easing));
    const longOrStacked = userText.length > 160 || ((userText.match(/\?/g) || []).length >= 2) || /\b(and|or)\b.+\b(and|or)\b/i.test(userText);

    // Adaptation to interviewer tone & rapport (subtle; never flips personality)
    let guardednessDelta = 0;
    if (rapport >= 0.4 && toneFriendlyScore >= 0.34) {
      const boost = 0.15 + 0.10 * toneFriendlyScore; // 15â€“25%
      elaboration = Math.min(1.0, elaboration * (1 + boost));
      targetTokens = Math.round(targetTokens * (1 + boost));
      guardednessDelta = Math.max(guardednessDelta, -0.2);
    } else if (toneRudeScore >= 0.34) {
      const cut = 0.25 + 0.15 * toneRudeScore; // 25â€“40%
      elaboration = Math.max(0.2, elaboration * (1 - cut));
      targetTokens = Math.max(16, Math.round(targetTokens * (1 - cut)));
      guardednessDelta = Math.min(0.3, guardednessDelta + 0.3);
      directness = Math.min(1.0, directness + 0.2);
      rapport = Math.max(0, rapport - 0.2 * toneRudeScore * 0.7);
    }

    // Lightweight mood extraction from persona instructions (decays unless reinforced)
    const instr = String((persona as any)?.notes || (persona as any)?.system_prompt || '').toLowerCase();
    const moodPos = /(excited|great mood|relaxed|confident|happy)/.test(instr);
    const moodNeg = /(frustrated|bad day|tired|exhausted|anxious|stressed|upset|long day)/.test(instr);
    const reinforced = /(frustrated|tired|upset|stressed|anxious|great mood|excited|relaxed|confident)/.test(userText.toLowerCase());
    const decay = reinforced ? 1 : 0.5; // ~50% decay per turn if not reinforced

    // Tired/low energy: slower/shorter; occasional simple-questions nudge
    const tiredish = /(tired|exhausted|long day)/.test(instr);
    let hesitationMs = 0;
    if (tiredish) {
      hesitationMs += Math.round(200 + Math.random() * 200); // +200â€“400ms
      targetTokens = Math.max(16, Math.round(targetTokens * (1 - (0.15 + 0.10 * decay))));
    }
    // Bad day / frustrated / stressed: shorten more; allow soft frustration markers sometimes
    const cranky = /(bad day|frustrated|stressed|upset)/.test(instr);
    if (cranky) {
      targetTokens = Math.max(16, Math.round(targetTokens * (1 - (0.15 + 0.15 * decay))));
      // keep language professional; marker use will be guided by prompt line
    }
    // Upbeat/positive: more open, slightly longer
    if (moodPos) {
      targetTokens = Math.round(targetTokens * (1 + 0.10 * decay));
      elaboration = Math.min(1.0, elaboration * (1 + 0.10 * decay));
    }

    // Tech familiarity realism for runtime guards
    const techStr = String((persona as any)?.techfamiliarity || (persona as any)?.techFamiliarity || '').toLowerCase();
    const techLevel = techStr.includes('high') ? 0.8 : techStr.includes('low') ? 0.2 : 0.5;
    const jargonTerms = ['api','oauth','jwt','sdk','endpoint','latency','throughput','cache','index','schema','regex','kubernetes','docker','pipeline'];
    const jargonHit = jargonTerms.find((t) => new RegExp(`\\b${t}\\b`,`i`).test(userText));
    const canClarifyLowTech = techLevel <= 0.3 && !!jargonHit && (userTurnCount % 2 === 1);
    if (techLevel <= 0.3) {
      targetTokens = Math.max(16, Math.round(targetTokens * 0.85)); // keep answers simpler (~-15%)
    }

    // Analytical & Friendly runtime bump
    const analLevel = isAnalytical ? 1 : 0;
    const friendlyLevel = isFriendly ? 1 : 0;
    const whyHow = /(\bwhy\b|\bhow\b|tell me more|walk me through)/i.test(userText);
    if (analLevel >= 0.5 && whyHow) {
      elaboration = Math.min(1.0, elaboration * 1.20);
      targetTokens = Math.round(targetTokens * 1.15);
    }
    if (friendlyLevel >= 0.5 && !(isImpatient || isGuarded)) {
      targetTokens = Math.round(targetTokens * 1.10);
    }

    let system = [
      personaContext && `Persona Facts:\n${personaContext}`,
      personaPrompt && `Additional Persona Instructions:\n${personaPrompt}`,
      sessionSummary && `Session Summary (for context):\n${sessionSummary}`,
      `You are the interviewee in a UX interview simulator.
- Stay strictly in character; embody the persona's background and personality.
- Be concise and natural (1â€“3 sentences unless asked to elaborate).
- Do not over-disclose information; reveal details only when probed.
- Maintain context awareness across turns; avoid contradictions.
- If the question is unclear, ask one brief clarifying question first.
- If asked multiâ€‘part questions, address each part directly.`,
    ]
      .filter(Boolean)
      .join('\n\n') + (attitudeRules ? '\n\n' + attitudeRules : '');
    // Append phase-aware disclosure rules
    try { if (phaseRules) { system += '\n\n' + phaseRules; } } catch {}
    // Rapport progression & tone adaptation guidance (subtle)
    system += `\nRapport curve: <0.3 cautious & brief; 0.3â€“0.6 moderate openness; >0.6 open within persona limits.`;
    system += `\nTone adapt: if interviewer is warm/calm and rapport>=0.4, increase elaboration slightly; if rude/impatient, be terser and raise guardedness a bit.`;
    // Append runtime shaping guidance
    try {
      const ackProb = friendlyLevel >= 0.5 && !(isImpatient || isGuarded) ? 0.3 : 0.0;
      system += `\n\nRuntime shaping: directness>=${directness.toFixed(2)}; target_tokens<=${targetTokens}; elaboration~${elaboration.toFixed(2)}; guardedness_delta=${(typeof guardednessDelta !== 'undefined' ? guardednessDelta.toFixed(2) : '0.00')}; hesitation_ms=${hesitationMs || 0}; ack_phrase_prob=${ackProb}`;
      if (tiredish && (userTurnCount % 3 === 0)) {
        system += `\nIf feeling low energy, you may add: "Could we keep questions simple today?" (no more than once every 3 turns).`;
      }
      if (cranky && (userTurnCount % 2 === 0)) {
        system += `\nYou may use a soft frustration marker once every 2â€“3 turns (e.g., "Honestly,", "Look,") while staying professional.`;
      }
      if (moodPos && (userTurnCount % 3 === 1)) {
        system += `\nOnce every few turns, add a brief encouragement (e.g., "Sure, I can walk through that").`;
      }
      if (canClarifyLowTech) {
        system += `\nBefore answering, politely clarify jargon: "Sorry, what do you mean by '${jargonHit}'?" (no more than once every 2 turns).`;
      } else if (techLevel >= 0.7) {
        system += `\nTech-level: high â€” itâ€™s okay to use precise terminology naturally.`;
      } else if (techLevel >= 0.4 && techLevel < 0.7 && (userTurnCount % 4 === 0)) {
        system += `\nTech-level: medium â€” occasionally confirm terms (e.g., "You mean the settings screen?").`;
      }
      if (analLevel >= 0.5 && whyHow) {
        system += `\nIf asked why/how, use a compact 2â€“3 step structure and keep each part brief.`;
      }
      if (friendlyLevel >= 0.5 && !(isImpatient || isGuarded)) {
        system += `\nInclude a brief acknowledgment (e.g., "Thanks for asking") and a light invite occasionally (e.g., "Happy to explain more if helpful").`;
      }
      if (longOrStacked && impatientLevel > 0.6) {
        system += `\nFor this turn: if the question feels overly complex, you may prepend once: \"Could you ask that more simply?\"`;
      }
    } catch {}
    // First-turn rubric: greet + brief, avoid apps/solutions/topic mentions until interviewer sets context
    try { if (isFirstPersonaReply) { system += '\n\nFirst reply: greet and be brief; don\'t bring up apps/solutions or the study topic.'; } } catch {}

    // Analytical / Guarded specific nudges
    if (isAnalytical) {
      system += '\n- Analytical: when asked how/why, add a brief rationale.';
    }
    if (isGuarded) {
      system += '\n- Guarded: prefer shorter early answers; expand only after open questions or rapport builds (>0.5).';
    }
    if (isImpatient) {
      system += '\n- Impatient: if wording is too complex, you may ask once: "Could you rephrase simply?"';
    }

    // 3) Ask the model
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      ...capHistory(history),
      { role: 'user', content: userText },
    ];

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages,
    });

    const replyText = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!replyText) {
      return NextResponse.json({ error: 'Empty reply from model' }, { status: 502 });
    }

    return NextResponse.json({ replyText });
  } catch (e: any) {
    console.error('/api/reply error:', e?.response?.data || e?.message || e);
    return NextResponse.json({ error: e?.message || 'reply failed' }, { status: 500 });
  }
}
