import { NextResponse } from "next/server";
import type { CoachSample, CoachResponse, CoachPolicy, CoachHint, CoachContext, CoachCategory } from "@/types/coach";
import { getCoachTip } from "@/lib/coach/llmCoach";
import { DefaultCoachPolicy } from "@/types/coach";

export const dynamic = "force-dynamic";

type SessionCounters = {
  lastHintAt: number;
  windowStart: number;
  countInWindow: number;
  questionsSeen: number; // approximate phase of interview
  lastTipLabels?: string[]; // anti-spam: prevent repeats
};

const counters = new Map<string, SessionCounters>();

function resolveSessionId(req: Request): string {
  const h = req.headers.get("x-session-id");
  if (h && h.trim()) return h.trim();
  const ref = req.headers.get("referer") || req.headers.get("referrer") || "";
  const m = /\/sessions\/([0-9a-fA-F\-]{8,})/.exec(ref);
  if (m && m[1]) return m[1];
  return "anon";
}

function blockedByPolicy(sessionId: string, policy: CoachPolicy): boolean {
  const now = Date.now();
  const c = counters.get(sessionId) || { lastHintAt: 0, windowStart: now, countInWindow: 0, questionsSeen: 0, lastTipLabels: [] };
  if (now - c.lastHintAt < policy.minGapMs) return true;
  if (now - c.windowStart > 60_000) {
    c.windowStart = now;
    c.countInWindow = 0;
  }
  if (c.countInWindow >= policy.maxHintsPerMinute) return true;
  return false;
}

function noteHint(sessionId: string, label?: string) {
  const now = Date.now();
  const c = counters.get(sessionId) || { lastHintAt: 0, windowStart: now, countInWindow: 0, questionsSeen: 0, lastTipLabels: [] };
  if (now - c.windowStart > 60_000) {
    c.windowStart = now;
    c.countInWindow = 0;
  }
  c.lastHintAt = now;
  c.countInWindow += 1;
  if (label) {
    c.lastTipLabels = Array.isArray(c.lastTipLabels) ? c.lastTipLabels : [];
    c.lastTipLabels.push(label);
    if (c.lastTipLabels.length > 3) c.lastTipLabels = c.lastTipLabels.slice(-3);
  }
  counters.set(sessionId, c);
}

function noteQuestion(sessionId: string) {
  const now = Date.now();
  const c = counters.get(sessionId) || { lastHintAt: 0, windowStart: now, countInWindow: 0, questionsSeen: 0, lastTipLabels: [] };
  c.questionsSeen += 1;
  counters.set(sessionId, c);
}

function isGreeting(q: string, policy: CoachPolicy): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (s.split(/\s+/).length < 3) return true;
  return policy.ignorePhrases.some((p) => s === p || s.startsWith(p + " "));
}

function last(strs: string[], n: number): string[] {
  const a = Array.isArray(strs) ? strs.filter(Boolean) : [];
  return a.slice(Math.max(0, a.length - n));
}

function heuristicCoach(sample: CoachSample, policy: CoachPolicy): CoachHint | null {
  const q = (sample.question || "").trim();
  const s = q.toLowerCase();
  if (isGreeting(q, policy)) {
    // Treat richer greetings as rapport-building instead of suppressing
    if (/\bhow are you( doing)?\b|\bhow'?s your (day|week)\b|\bthanks\b|\bappreciate\b/.test(s)) {
      return { kind: "rapport", text: "Good rapport building." };
    }
    return null;
  }

  // rapport building recognition (non-greeting phrasing)
  if (/\bthanks for (joining|taking the time)\b|\bappreciate you being here\b/.test(s)) {
    return { kind: "rapport", text: "Good rapport building." };
  }

  // boundary check
  const sensitive = /(income|salary|address|medical|religion|school|company)/.test(s);
  const specific = /(which|what|where|who)/.test(s);
  if (sensitive && specific) {
    return { kind: "boundary", text: "That may feel uncomfortable for a persona. Reframe or avoid specifics." };
  }

  // tone / disrespect detection
  if (/(\bfuck\b|\bshit\b|\bdumb\b|\bstupid\b|\bidiot\b|\bbitch\b|\bbastard\b)/.test(s)) {
    return { kind: "boundary", text: "Adjust tone, this could harm the interview." };
  }

  // fact-checking praise
  if (/\bjust to confirm\b|\bdid i get that right\b|\byou said\b|\byou mentioned\b|\bto clarify\b|\blet me make sure\b/.test(s)) {
    return { kind: "praise", text: "Good fact-checking." };
  }

  // clarify check (leading or compound question)
  const sLead = s.replace(/^(and|so|well|uh|um|ok|okay|hmm)[,\s-]+/i, "");
  if (/don\'t you think|wouldn\'t you say/.test(sLead) || /\?\s*and\s+/.test(q) || /\band\b.+\?\s*$/.test(q) || /\bwhat\b[^?]+\band\b[^?]+\?/.test(sLead)) {
    return { kind: "clarify", text: "Good to split this into two questions." };
  }

  // praise for good openers (allow light fillers at start)
  if (/^(how|what|why)\b/.test(sLead) || sLead.startsWith("can you tell me about") || sLead.startsWith("describe")) {
    return { kind: "praise", text: "Nice open question. Give space and follow up gently." };
  }

  // probe if last assistant answer was short OR the question is broad open-ended
  const lastAssist = last(sample.lastAssistTurns || [], 1)[0] || "";
  const shortAssist = lastAssist.trim().length > 0 && lastAssist.trim().length < 80;
  const openEnded = /\b(how|why|what|tell me about|describe)\b/.test(sLead);
  if (openEnded) {
    return { kind: "probe", text: "Consider a soft probe: 'Could you share a specific example?'" };
  }

  // rapport (default nudge)
  if (/\bthank\b|\bthanks\b/.test(s)) {
    return { kind: "rapport", text: "Acknowledge and keep a warm tone; reflect back briefly." };
  }

  return null;
}

// === Lightweight classifiers and context builder (spec-driven) ===
const ADMIN_RE = /(\bname\b|\bage\b|\bemail\b|\bconsent\b|\brecording\b|\brole\b|\bpronouns?\b)/i;
const RAPPORT_RE = /(\bhi\b|\bhello\b|\bhey\b|\bthanks\b|\bthank you\b|\bappreciate\b|\bsorry to hear\b|\bthat makes sense\b|\bi hear you\b)/i;
const FACTCHECK_RE = /(\bjust to confirm\b|\bto clarify\b|\bso (you'?re|you are) saying\b|\bdid i get (this|that) right\b)/i;
const CLOSED_START_RE = /^(is|are|do|did|does|can|could|will|would|have|has|had|was|were|should|shall)\b/i;
const OPEN_START_RE = /^(how|what|why|describe|tell me|walk me( through)?|could you explain|can you tell)/i;
const PROFANITY_RE = /(\bfuck\b|\bshit\b|\basshole\b|\bbitch\b|\bidiot\b|\bstupid\b|\bdumb\b)/i;
const HOSTILE_RE = /(\bcalm down\b|\bthat'?s (dumb|stupid)\b|\bwhat'?s wrong with you\b|\bthis makes no sense\b)/i;
const SENSITIVE_RE = /(\bincome\b|\bsalary\b|\bdebt\b|\bcredit (score|card)\b|\bbank(ing)?\b|\bmortgage\b|\brent\b|\bmedical\b|\bill(n|ness)\b|\bdiagnos\w+\b|\btherapy\b|\bfamily\b|\bspouse\b|\bpartner\b|\bkids?\b|\breligion\b)/i;

function normalizeDomain(raw?: string): string {
  const s = (raw || "").toLowerCase();
  if (!s) return "general";
  if (s.includes("bank") || s.includes("fintech") || s.includes("finance")) return "banking";
  if (s.includes("health")) return "healthcare";
  if (s.includes("ecommerce") || s.includes("retail") || s.includes("store")) return "ecommerce";
  if (s.includes("productivity") || s.includes("notes") || s.includes("calendar") || s.includes("tasks")) return "productivity";
  if (s.includes("education") || s.includes("learning") || s.includes("edtech")) return "education";
  if (s.includes("travel") || s.includes("flight") || s.includes("hotel")) return "travel";
  if (s.includes("streaming") || s.includes("media")) return "streaming";
  if (s.includes("hr") || s.includes("recruit") || s.includes("interview")) return "hr";
  if (s.includes("dev") || s.includes("api") || s.includes("developer")) return "devtools";
  return "general";
}

function adminPairExempt(q: string): boolean {
  const s = q.toLowerCase();
  return /\b(name|role)\b\s*(,?\s*(and|&)\s*)\b(age|tenure|pronouns?)\b/.test(s) || /\bage\b\s*(,?\s*(and|&)\s*)\b(pronouns?|role)\b/.test(s);
}

function detectDoubleBarrel(q: string): boolean {
  const qMarks = (q.match(/\?/g) || []).length;
  if (qMarks > 1) return true;
  if (/\bwhat\b[^?]+\band\b[^?]+\?/.test(q.toLowerCase())) return true;
  return false;
}

function classifyType(text: string): CoachContext["type"] {
  const s = text.trim().toLowerCase();
  if (!s) return "open";
  if (ADMIN_RE.test(s)) return "admin";
  if (FACTCHECK_RE.test(s)) return "factcheck";
  if (RAPPORT_RE.test(s)) return "rapport";
  if (OPEN_START_RE.test(s)) return "open";
  if (CLOSED_START_RE.test(s)) return "closed";
  if (s.endsWith("?") && !CLOSED_START_RE.test(s)) return "open";
  return "open";
}

function buildContextFromSample(sessionId: string, sample: any): CoachContext {
  const q = String(sample?.question || "");
  const nowSec = Math.floor(Date.now() / 1000);
  const lastAssistText = Array.isArray(sample?.lastAssistTurns) && sample.lastAssistTurns.length
    ? String(sample.lastAssistTurns[sample.lastAssistTurns.length - 1])
    : "";
  const lastUserText = Array.isArray(sample?.lastUserTurns) && sample.lastUserTurns.length
    ? String(sample.lastUserTurns[sample.lastUserTurns.length - 1])
    : "";

  const ctx: CoachContext = {
    text: q,
    ts: typeof sample?.context?.ts === 'number' ? sample.context.ts : nowSec,
    lastAssistant: sample?.context?.lastAssistant ?? (lastAssistText ? { text: lastAssistText, wordCount: lastAssistText.split(/\s+/).filter(Boolean).length, ts: 0 } : null),
    lastUser: sample?.context?.lastUser ?? (lastUserText ? { text: lastUserText, ts: 0 } : null),
    persona: sample?.context?.persona ?? {
      age: sample?.personaSummary?.age,
      personality: sample?.personaSummary?.personality,
      traits: sample?.personaSummary?.traits || [],
      instructions: sample?.personaSummary?.extraInstructions || (sample?.personaKnobs ? JSON.stringify(sample.personaKnobs) : undefined),
    },
    domain: normalizeDomain(sample?.context?.domain || sample?.domain || sample?.project?.domain || (Array.isArray(sample?.project?.domain_tags) ? String(sample.project.domain_tags[0] || '') : 'general')),
    type: sample?.context?.type || classifyType(q),
    tone: sample?.context?.tone || { hostile: HOSTILE_RE.test(q), profanity: PROFANITY_RE.test(q), impatient: false },
    structure: sample?.context?.structure || { doubleBarrel: detectDoubleBarrel(q), overlyLong: q.split(/\s+/).length > 28 },
  };
  try {
    if (ctx.lastAssistant && typeof ctx.lastAssistant.ts === 'number' && ctx.lastAssistant.ts > 0 && Math.abs(ctx.ts - ctx.lastAssistant.ts) < 2) {
      ctx.tone.impatient = true;
    }
  } catch {}
  if (ctx.type === 'admin' && adminPairExempt(q)) ctx.structure.doubleBarrel = false;
  return ctx;
}

function domainProbeKeywords(domain: string): string[] {
  switch (domain) {
    case 'banking': return ['fees', 'security', 'bill pay', 'alerts'];
    case 'ecommerce': return ['checkout', 'returns', 'shipping', 'search', 'reviews'];
    case 'productivity': return ['tasks', 'calendar', 'notes', 'collaboration', 'sync'];
    case 'healthcare': return ['appointments', 'billing', 'records', 'privacy', 'insurance'];
    case 'education': return ['assignments', 'grading', 'feedback', 'progress', 'mobile'];
    case 'travel': return ['booking', 'check-in', 'cancellations', 'loyalty', 'alerts'];
    case 'streaming': return ['recommendations', 'search', 'quality', 'downloads', 'subscriptions'];
    case 'hr': return ['feedback', 'evaluations', 'payroll', 'time off'];
    case 'devtools': return ['docs', 'errors', 'auth', 'latency', 'sdk'];
    default: return ['examples', 'clarity', 'search', 'navigation', 'notifications'];
  }
}

function buildSuggestedQuestion(ctx: CoachContext, lastAssist: string | undefined): string | null {
  const lower = (ctx.text || '').toLowerCase();
  const kw = domainProbeKeywords(ctx.domain);
  const topic = kw[0] || 'that';
  const shortAssist = (lastAssist || '').split(/\s+/).filter(Boolean).length < 12;
  if (ctx.type === 'closed') {
    // rewrite closed → open
    const rewrite = ctx.text.replace(/^(is|are|do|did|does|can|could|will|would|have|has|had|was|were|should|shall)\b/i, 'How').replace(/\?\s*$/, '').trim();
    return rewrite ? `${rewrite}?` : `How do you keep track of ${topic}?`;
  }
  if (ctx.type === 'open' && shortAssist) {
    return `Could you share a specific example about ${topic}?`;
  }
  if (ctx.type === 'rapport') {
    return `What would make ${topic} easier for you?`;
  }
  if (ctx.type === 'factcheck') {
    return `Am I understanding correctly that ${topic} is the main pain?`;
  }
  // default follow-up
  return `What made ${topic} difficult recently?`;
}

function chooseHintFromContext(ctx: CoachContext): CoachHint | null {
  const s = ctx.text.trim();
  const lower = s.toLowerCase();
  const category = (c: CoachCategory) => c;
  const lastAssistText = ctx.lastAssistant?.text || '';
  // Tone safety
  if (ctx.tone.hostile || ctx.tone.profanity) {
    return { kind: 'boundary', category: category('Tone'), text: 'Tone check: soften language—this can shut the participant down. Try acknowledging and refocusing.' };
  }
  if (ctx.tone.impatient) {
    return { kind: 'boundary', category: category('Tone'), text: 'Let them finish. Pausing 1–2s often yields richer details.' };
  }
  // Boundary & ethics
  if (SENSITIVE_RE.test(lower) && !/(so (we|I) can|to help|because)/i.test(lower)) {
    return { kind: 'boundary', category: category('Boundary'), text: "This may feel personal—frame the 'why' first, e.g., 'So we can tailor the flow, could you…'" };
  }
  // Follow-up discipline
  const shortAssist = ctx.lastAssistant && ctx.lastAssistant.wordCount > 0 && ctx.lastAssistant.wordCount < 12;
  const notFollowUp = ctx.type !== 'factcheck' && ctx.type !== 'rapport' && ctx.type !== 'admin';
  if (shortAssist && notFollowUp) {
    const suggestion = buildSuggestedQuestion(ctx, lastAssistText);
    return { kind: 'probe', category: category('Follow-up'), text: `They gave a short answer—follow up on something concrete. Suggested: "${suggestion}"` };
  }
  // Question craft
  if (ctx.structure.doubleBarrel && ctx.type !== 'admin') {
    const m = /(.+?)\band\b(.+?)\?\s*$/.exec(lower);
    if (m) {
      const X = m[1].trim();
      const Y = m[2].trim();
      return { kind: 'clarify', category: category('Craft'), text: `Split this into two: one on '${X}', then a follow-up on '${Y}'.` };
    }
    return { kind: 'clarify', category: category('Craft'), text: 'Split this into two focused questions.' };
  }
  if (ctx.type === 'closed' && ctx.type !== 'factcheck' && ctx.type !== 'admin') {
    const suggestion = buildSuggestedQuestion(ctx, lastAssistText) || 'How do you handle this?';
    return { kind: 'probe', category: category('Craft'), text: `Ask open instead of yes/no. Suggested: "${suggestion}"` };
  }
  // Reinforcement
  if (ctx.type === 'rapport') {
    const suggestion = buildSuggestedQuestion(ctx, lastAssistText);
    return { kind: 'rapport', category: category('Reinforcement'), text: `Nice rapport. When ready, pivot to specifics. Suggested: "${suggestion}"` };
  }
  if (ctx.type === 'open') {
    const suggestion = shortAssist ? buildSuggestedQuestion(ctx, lastAssistText) : null;
    if (suggestion) return { kind: 'probe', category: category('Follow-up'), text: `Good open. Keep them concrete. Suggested: "${suggestion}"` };
    return { kind: 'praise', category: category('Reinforcement'), text: 'Good open. Give space, then ask for an example.' };
  }
  // Domain-specific probe fallback
  const domainProbe = domainProbeKeywords(ctx.domain)[0];
  if (domainProbe) return { kind: 'probe', category: category('Follow-up'), text: `Consider a focused probe on "${domainProbe}".` };
  return null;
}

// --- New semantic analyzer for richer, contextual feedback ---
function extractTopics(text: string, max = 2): string[] {
  const stop = new Set(['the','and','that','this','with','have','your','about','just','like','really','very','kind','okay','yeah','you','are','was','were','will','would','could','should','they','them','their','there','i','me','my','we','our']);
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w && w.length>=4 && !stop.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w]||0)+1;
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,max).map(([w])=>w);
}

function analyzeIntent(question: string) {
  const s = question.toLowerCase().trim();
  if (/(before we wrap|any final|last question|to close|to summarize|summary)/.test(s)) return 'closing';
  if (/^\s*(how|what|why|describe|tell me|walk me through|could you explain)\b/.test(s) || /\?$/.test(s)) return 'probing';
  if (/(just to confirm|to clarify|so you'?re saying|did i get (this|that) right)/.test(s)) return 'factcheck';
  if (/(hi|hello|hey|how are you|thanks|appreciate)/.test(s)) return 'rapport';
  return 'other';
}

function analyzeTone(question: string) {
  const s = question.toLowerCase();
  const warm = /(please|thanks|could you|would you|if you don't mind)/.test(s);
  const rushed = /(quick|real quick|just|now)/.test(s) || /!!|\?\?/.test(question);
  const direct = /(tell me|give me|i need|explain)/.test(s);
  const insensitive = /(why didn't you|you should have|that's wrong)/.test(s);
  return { warm, rushed, direct, insensitive };
}

function analyzePersonaReaction(lastAssistant: string) {
  const t = String(lastAssistant || '');
  const short = t.trim().split(/\s+/).length < 8;
  const guarded = short || /(not sure|prefer not|maybe|depends|idk|i don't know)/i.test(t);
  const stressed = /(stress|overwhelm|anxious|hard|frustrat|tired|busy)/i.test(t);
  const open = t.split(/\s+/).length > 25 || /(happy to|i usually|i often|for example)/i.test(t);
  return { guarded, stressed, open };
}

function isBenignAnd(question: string) {
  // Allow simple paired asks like "name and age", "pros and cons"
  const s = question.toLowerCase();
  return /(name and age|pros and cons|time and place|when and where)/.test(s);
}

function hasDoubleBarrel(question: string) {
  const s = question.toLowerCase();
  const multiQ = (question.match(/\?/g) || []).length >= 2;
  const andJoin = /\b(and|&){1}\b/.test(s) && /(how|what|why|is|are|do|did|can|will|have|has|was|were)\b.*\b(and)\b.*(how|what|why|is|are|do|did|can|will|have|has|was|were)\b/.test(s);
  return (multiQ || andJoin) && !isBenignAnd(s);
}

// === Mentor-style intent classifier (lightweight) ===
function classifyIntentPrimary(s: string): { primary: string; tags: string[] } {
  const q = String(s || '').trim().toLowerCase();
  const tags: string[] = [];
  const isGreeting = /(\bhi\b|\bhello\b|\bhey\b|how are you|thanks|thank you|appreciate)/.test(q);
  const isBio = /(\bname\b|\bage\b|\bpronouns?\b|\brole\b|\btitle\b)/.test(q) || /tell me about yourself|a bit about yourself/.test(q);
  const isScope = /(we.?re (designing|building)|\btoday\b|in this (study|interview)|\bscope\b|\bfocus\b|\btopic\b|we\b.*(talk|cover|explore)|let.?s (talk|cover|focus))/.test(q);
  const isFollow = /(you (said|mentioned)|tell me more|what happened next|and then|earlier|you were saying)/.test(q);
  const isClarify = /(just to confirm|to clarify|did i get (this|that) right|do you mean|when you say)/.test(q);
  const isReflect = /(sounds like|i hear you|that makes sense|i can see|i get that|i understand)/.test(q);
  const isTransition = /(let.?s move on|switch gears|on another note|changing topic|next topic)/.test(q);
  const isSensitive = /(income|salary|address|password|passcode|medical|bank( details)?|account (number|no\.)|routing|ssn|social security)/.test(q);
  const isClosed = /^(is|are|do|did|does|can|could|will|would|have|has|had|was|were|should|shall)\b/.test(q);
  const endsQ = /\?$/.test(q);
  if (isGreeting) { tags.push('greeting'); return { primary: 'greeting', tags }; }
  if (isBio) { tags.push('bio_setup'); return { primary: 'bio_setup', tags }; }
  if (isScope) { tags.push('scope_setting'); return { primary: 'scope_setting', tags }; }
  if (isFollow) { tags.push('follow_up'); return { primary: 'follow_up', tags }; }
  if (isClarify) { tags.push('clarification'); return { primary: 'clarification', tags }; }
  if (isReflect) { tags.push('reflection'); return { primary: 'reflection', tags }; }
  if (isTransition) { tags.push('transition'); return { primary: 'transition', tags }; }
  if (isSensitive) { tags.push('sensitive'); return { primary: 'sensitive', tags }; }
  if (isClosed) { tags.push('closed_question'); return { primary: 'closed_question', tags }; }
  if (endsQ) { tags.push('open_question'); return { primary: 'open_question', tags }; }
  tags.push('open_question');
  return { primary: 'open_question', tags };
}

function shouldSuppressTip(primary: string, phase: 'early'|'mid'|'late'): boolean {
  if (primary === 'greeting' || primary === 'reflection' || primary === 'transition') return true;
  if (primary === 'bio_setup' && phase === 'early') return true;
  return false;
}

function formatTip(label: string, message: string, suggestion?: string) {
  return { label, message, ...(suggestion ? { suggestion } : {}) } as { label: string; message: string; suggestion?: string };
}

function improvePhrasing(intent: string, topics: string[], tone: ReturnType<typeof analyzeTone>) {
  const ex: string[] = [];
  const topic = topics[0] || 'that';
  if (intent === 'probing') {
    ex.push(`Could you share a specific example of ${topic}?`);
    ex.push(`What made ${topic} challenging for you recently?`);
  } else if (intent === 'factcheck') {
    ex.push(`Just to confirm, did I capture this right about ${topic}?`);
    ex.push(`Am I understanding correctly that ${topic} is the main issue?`);
  } else if (intent === 'rapport') {
    ex.push(`How's your day going so far?`);
    ex.push(`Before we start, anything you'd like me to know?`);
  } else if (intent === 'closing') {
    ex.push(`Is there anything important we didn't cover today?`);
    ex.push(`If you could change one thing about ${topic}, what would it be?`);
  } else {
    ex.push(`Could you walk me through ${topic}?`);
    ex.push(`What would a better ${topic} look like for you?`);
  }
  if (tone.direct && !tone.warm) {
    // soften a direct tone
    ex[0] = ex[0].replace(/^/, 'If you’re comfortable, ');
  }
  return ex.slice(0,2);
}

function semanticCoach(sessionId: string, sample: any): CoachHint | null {
  try {
    const q = String(sample?.question || '').trim();
    if (!q) return null;
    const lastAssist = (sample?.lastAssistTurns || [])[ (sample?.lastAssistTurns?.length || 1) - 1 ] || '';
    const intent = analyzeIntent(q);
    const tone = analyzeTone(q);
    const react = analyzePersonaReaction(lastAssist);
    const topics = extractTopics(lastAssist, 2);

    const countersState = counters.get(sessionId) || { lastHintAt: 0, windowStart: Date.now(), countInWindow: 0, questionsSeen: 0 };
    const phase = countersState.questionsSeen < 2 ? 'early' : countersState.questionsSeen < 6 ? 'mid' : 'late';

    let textParts: string[] = [];
    // Intent framing
    if (intent === 'rapport' && phase === 'early') {
      textParts.push("Good rapport building — you’re helping the persona feel at ease.");
    } else if (intent === 'probing' && topics.length) {
      textParts.push(`Try following up on what they said about ${topics.join(', ')}.`);
    } else if (intent === 'closing' && phase !== 'late') {
      textParts.push("Save closing questions for the end; build depth first.");
    } else if (intent === 'factcheck') {
      textParts.push("Good fact-checking to keep details accurate.");
    }

    // Persona reaction context
    if (react.stressed) textParts.push("The persona sounds stressed; slow your pace and acknowledge feelings.");
    else if (react.guarded) textParts.push("The persona seems defensive; consider a more curious, softer phrasing.");
    else if (react.open && intent !== 'probing') textParts.push("They’re open right now — consider a gentle probe.");

    // Double‑barrel caution, but allow benign pairs
    if (hasDoubleBarrel(q)) textParts.push("This reads as two questions; ask one at a time to keep them focused.");

    const examples = improvePhrasing(intent, topics, tone);
    if (examples.length) textParts.push(`Examples: “${examples[0]}”${examples[1] ? ` | “${examples[1]}”` : ''}`);

    // Map to hint kind
    let kind: CoachHint['kind'] = 'probe';
    if (intent === 'rapport') kind = 'praise';
    else if (intent === 'factcheck') kind = 'praise';
    else if (hasDoubleBarrel(q)) kind = 'clarify';
    else if (tone.insensitive) kind = 'boundary';

    return { kind, text: textParts.join(' ') };
  } catch { return null; }
}

async function maybeLLM(sample: CoachSample): Promise<CoachHint | null> {
  // Optional LLM path; only if explicitly enabled and credentials exist.
  try {
    if (process.env.COACH_USE_LLM !== "1") return null;
    const key = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (!key) return null;
    const content = `You are an interview coach. Read the interviewer question and context. Reply with one short hint (<= 18 words) prefixed by one of [probe|praise|boundary|clarify|rapport]:\nQuestion: ${sample.question}\nLastUser: ${(sample.lastUserTurns || []).join(" | ")}\nLastAssist: ${(sample.lastAssistTurns || []).join(" | ")}`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content }] }),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    const text: string = data?.choices?.[0]?.message?.content || "";
    const m = /^(probe|praise|boundary|clarify|rapport)\s*:\s*(.+)/i.exec(text);
    if (m) {
      const kind = m[1].toLowerCase() as CoachHint["kind"];
      return { kind, text: m[2].trim() };
    }
    // default to praise-style nudge
    if (text.trim()) return { kind: "praise", text: text.trim().slice(0, 120) };
  } catch {}
  return null;
}

export async function POST(req: Request) {
  const sessionId = resolveSessionId(req);
  const policy = DefaultCoachPolicy;
  try {
    const sample = (await req.json().catch(() => ({}))) as (CoachSample & { context?: CoachContext }) | any;
    const q = String(sample?.question ?? sample?.context?.text ?? "");
    if (!q.trim()) return NextResponse.json({ hints: [] } satisfies CoachResponse);
    noteQuestion(sessionId);
    if (blockedByPolicy(sessionId, policy)) return NextResponse.json({ hints: [] } satisfies CoachResponse);

    // Prefer client-provided context; otherwise derive it server-side
    const ctx = sample?.context && sample.context.text ? (sample.context as CoachContext) : buildContextFromSample(sessionId, sample);

    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[coach:context]', {
        text: ctx.text,
        ts: ctx.ts,
        lastAssistant: ctx.lastAssistant ? { wordCount: ctx.lastAssistant.wordCount, ts: ctx.lastAssistant.ts } : null,
        lastUser: ctx.lastUser ? { ts: ctx.lastUser.ts } : null,
        domain: ctx.domain,
        type: ctx.type,
        tone: ctx.tone,
        structure: ctx.structure,
      });
    }

    // Phase for early bio-setup suppression
    const countersState = counters.get(sessionId) || { lastHintAt: 0, windowStart: Date.now(), countInWindow: 0, questionsSeen: 0, lastTipLabels: [] };
    const phase: 'early'|'mid'|'late' = countersState.questionsSeen < 2 ? 'early' : countersState.questionsSeen < 6 ? 'mid' : 'late';
    const intents = classifyIntentPrimary(ctx.text);

    // Decide mentor-style tip (non-breaking, additive)
    let tip: { label: string; message: string; suggestion?: string; severity?: string } | null = null;
    const lastAssist = ctx.lastAssistant?.text || '';
    const lastAssistWords = ctx.lastAssistant?.wordCount || lastAssist.split(/\s+/).length;
    const topics = extractTopics(lastAssist, 1);
    const topic = topics[0] || 'that';
    const react = analyzePersonaReaction(lastAssist);

    const lastLabels = Array.isArray(countersState.lastTipLabels) ? countersState.lastTipLabels : [];
    const labelNotRecent = (label: string) => lastLabels.indexOf(label) === -1;

    if (!shouldSuppressTip(intents.primary, phase)) {
      // Try LLM mentor tip first (repair-only, additive). Build a compact recent history.
      try {
        const recent: { speaker: 'interviewer'|'participant'; text: string }[] = [];
        const la: string[] = Array.isArray(sample?.lastAssistTurns) ? sample.lastAssistTurns.slice(-4) : [];
        const lu: string[] = Array.isArray(sample?.lastUserTurns) ? sample.lastUserTurns.slice(-4) : [];
        for (const t of la) recent.push({ speaker: 'participant', text: String(t) });
        for (const t of lu) recent.push({ speaker: 'interviewer', text: String(t) });
        recent.push({ speaker: 'interviewer', text: q });
        const personaBrief = (() => {
          try { return JSON.stringify(sample?.personaSummary || sample?.personaKnobs || {}, null, 0).slice(0, 400); } catch { return undefined; }
        })();
        const llmTip = await getCoachTip({ turns: recent as any, currentInterviewerText: q, personaBrief });
        if (llmTip && labelNotRecent(llmTip.label)) {
          tip = { label: llmTip.label, message: llmTip.message, suggestion: llmTip.suggestion, severity: llmTip.severity };
        }
      } catch {}

      // Emotion-aware de-escalate
      if (!tip && react.stressed && labelNotRecent('De-escalate')) {
        tip = formatTip('De-escalate', "I'm hearing some frustration. That sounds tough—what led to that?");
      }
      // Sensitive ask
      else if (!tip && intents.primary === 'sensitive' && labelNotRecent('Sensitive')) {
        tip = formatTip('Sensitive', 'This can be personal. Give a reason and an opt-out.', 'To tailor the study, could you share…? Totally fine to skip.');
      }
      // Follow-up opportunity: long answer but current turn not follow-up
      else if (!tip && lastAssistWords >= 18 && intents.primary !== 'follow_up' && labelNotRecent('Follow-up chance')) {
        tip = formatTip('Follow-up chance', `There’s something to unpack there. Earlier you mentioned ${topic}—what made that difficult?`);
      }
      // Closed → Open (and not a clarifying confirm)
      else if (!tip && intents.primary === 'closed_question' && labelNotRecent('Closed → Open')) {
        const suggestion = buildSuggestedQuestion(ctx, lastAssist) || `How did you handle ${topic}?`;
        tip = formatTip('Closed → Open', 'This may limit detail. Try:', suggestion);
      }
      // Clarify gently
      else if (!tip && hasDoubleBarrel(ctx.text) && labelNotRecent('Clarify gently')) {
        tip = formatTip('Clarify gently', `Quick check: When you say it, do you mean ${topic} A or B?`);
      }
      // Rapport → Specifics (mid/late only)
      else if (!tip && (intents.primary === 'greeting' || intents.primary === 'scope_setting')) {
        // no tip
      } else if (!tip && (intents.primary === 'open_question' || intents.primary === 'bio_setup') && phase !== 'early' && labelNotRecent('Rapport → Specifics')) {
        tip = formatTip('Rapport → Specifics', 'Nice start. When you’re ready, zoom in:', `What’s the most frustrating part of ${topic}?`);
      }
    }

    // Legacy hint as fallback (backward-compatible)
    let hint: CoachHint | null = null;
    if (!tip) {
      hint = chooseHintFromContext(ctx) || semanticCoach(sessionId, sample) || await maybeLLM(sample) || heuristicCoach(sample, policy);
    }

    // Enforce anti-spam label repeat and note hint
    if (tip) {
      if (labelNotRecent(tip.label)) {
        noteHint(sessionId, tip.label);
      } else {
        tip = null; // suppress repeated label within recent window
      }
    } else if (hint) {
      // Backfill category for legacy hints
      if (!(hint as any).category) {
        const kind = (hint as any).kind as CoachHint['kind'];
        const cat: CoachCategory = kind === 'boundary' ? 'Tone' : kind === 'clarify' ? 'Craft' : (kind === 'praise' || kind === 'rapport') ? 'Reinforcement' : 'Follow-up';
        (hint as any).category = cat;
      }
      noteHint(sessionId, (hint as any).category || 'hint');
    }

    if (hint || tip) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[coach:tip]', { tip, hint: hint ? { kind: (hint as any).kind, text: (hint as any).text } : null, intents });
      }
      return NextResponse.json({ hints: hint ? [hint] : [], tip, intents: intents.tags } satisfies CoachResponse);
    }
    return NextResponse.json({ hints: [], tip: null, intents: intents.tags } satisfies CoachResponse);
  } catch (err) {
    return NextResponse.json({ hints: [], tip: null } satisfies CoachResponse, { status: 200 });
  }
}
