import type { Turn } from "@/types/report";

// Basic helpers
export const isQ = (t: string) => /\?$/.test(String(t || '').trim());
export const words = (t: string) => String(t || '').trim().split(/\s+/).filter(Boolean);

// Heuristic classification rules
const OPEN_PREFIX = /^(how|what|why|describe|tell me|walk me through|could you explain)/i;
const CLOSED_PREFIX = /^(is|are|do|did|can|will|have|has|was|were)\b/i;
const RAPPORT_RE = /(\bhi\b|\bhello\b|\bhey\b|how are you|good (morning|afternoon)|thanks|thank you|appreciate)/i;
const FACT_RE = /(just to confirm|to clarify|so you'?re saying|did i get (this|that) right)/i;

export const isOpen = (t: string) => {
  const s = String(t || '').trim();
  if (OPEN_PREFIX.test(s)) return true;
  if (isQ(s) && !CLOSED_PREFIX.test(s)) return true;
  return false;
};

export const isClosed = (t: string) => CLOSED_PREFIX.test(String(t || '').trim());
const isRapport = (t: string) => RAPPORT_RE.test(String(t || ''));
const isFactCheck = (t: string) => FACT_RE.test(String(t || ''));

export type QType = "open" | "closed" | "rapport" | "factcheck" | "other";
export function classifyQuestion(text: string): QType {
  const s = String(text || '').trim();
  if (!s) return 'other';
  if (isRapport(s)) return 'rapport';
  if (isFactCheck(s)) return 'factcheck';
  if (isOpen(s)) return 'open';
  if (isClosed(s)) return 'closed';
  return isQ(s) ? 'closed' : 'other';
}

// Aggregates
export function talkTimeRatio(turns: Turn[]) {
  // Use word counts to estimate talk balance
  const userWords = turns.filter((t) => t.speaker === 'user').reduce((a, t) => a + words(t.text).length, 0);
  const asstWords = turns.filter((t) => t.speaker === 'assistant').reduce((a, t) => a + words(t.text).length, 0);
  const total = Math.max(1, userWords + asstWords);
  return { userPct: Math.round((userWords / total) * 100), assistantPct: Math.round((asstWords / total) * 100) };
}

export function openVsClosed(turns: Turn[]) {
  const userQs = turns.filter((t) => t.speaker === 'user' && classifyQuestion(t.text) !== 'other');
  const open = userQs.filter((t) => classifyQuestion(t.text) === 'open').length;
  const closed = userQs.filter((t) => classifyQuestion(t.text) === 'closed').length;
  return { open, closed };
}

export function questionTypeRatio(turns: Turn[]) {
  const out = { open: 0, closed: 0, rapport: 0, factcheck: 0 };
  for (const t of turns) {
    if (t.speaker !== 'user') continue;
    const c = classifyQuestion(t.text);
    if (c in out) (out as any)[c] += 1;
  }
  return out;
}

// Follow-up detection (heuristic): user question soon after assistant, with follow-up cues
function isFollowUpQuestion(turns: Turn[], idx: number): boolean {
  const t = turns[idx];
  if (!t || t.speaker !== 'user') return false;
  const s = String(t.text || '').trim();
  if (!isQ(s)) return false;
  // find previous assistant turn
  let j = idx - 1;
  while (j >= 0 && turns[j].speaker === 'user') j--;
  if (j < 0 || turns[j].speaker !== 'assistant') return false;
  const delta = Math.abs((Number(t.at) || 0) - (Number(turns[j].at) || 0));
  const cues = /(why|how|what (else|specifically)|tell me more|more about|for example|example|specifically|could you (expand|elaborate)|and then)\b/i;
  return delta <= 20_000 || cues.test(s);
}

export function questionTypesWithFollowUp(turns: Turn[]) {
  const base = questionTypeRatio(turns);
  let followUp = 0;
  for (let i = 0; i < turns.length; i++) {
    if (isFollowUpQuestion(turns, i)) followUp += 1;
  }
  return { open: base.open, closed: base.closed, rapport: base.rapport, factCheck: base.factcheck, followUp };
}

// Longest consecutive follow-up chain for interviewer
export function followUpChainDepth(turns: Turn[]) {
  let longest = 0;
  let current = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker === 'user' && isFollowUpQuestion(turns, i)) {
      current += 1;
    } else {
      if (current > longest) longest = current;
      current = 0;
    }
  }
  if (current > longest) longest = current;
  return longest;
}

type QuoteStrength = { quote: string; note: string };
type QuoteImprove = { quote: string; note: string; suggestion?: string };
export function buildInsightsQuotes(turns: Turn[]): { strengths: QuoteStrength[]; improvements: QuoteImprove[] } {
  const strengths: QuoteStrength[] = [];
  const improvements: QuoteImprove[] = [];
  // Strength 1: open question by user
  for (const t of turns) {
    if (t.speaker === 'user' && isOpen(t.text)) {
      strengths.push({ quote: t.text, note: 'Open question — invites elaboration.' });
      break;
    }
  }
  // Strength 2: enthusiastic participant reply
  for (const t of turns) {
    if (t.speaker === 'assistant' && /(definitely|love|great|usually|often|for example|i like|i enjoy|happy to)/i.test(String(t.text||''))) {
      strengths.push({ quote: t.text, note: 'Participant engaged — good rapport signal.' });
      break;
    }
  }
  // Improvements from missed opportunities (short assistant then topic change)
  for (let i = 0; i < turns.length - 2 && improvements.length < 2; i++) {
    const u1 = turns[i];
    const a = turns[i+1];
    const u2 = turns[i+2];
    if (u1.speaker !== 'user' || a.speaker !== 'assistant' || u2.speaker !== 'user') continue;
    const aWords = words(a.text).length;
    const within15s = Math.abs((u2.at || 0) - (u1.at || 0)) <= 15_000;
    const follow = isOpen(u2.text) || /\b(why|how|example|more|tell me more|could you)\b/i.test(u2.text);
    if (aWords < 12 && within15s && !follow) {
      improvements.push({ quote: a.text, note: 'Short answer — consider probing once more.' });
    }
  }
  // Improvements from closed questions with a suggestion
  const rewrites = suggestRewritesV2(turns, 3);
  for (const r of rewrites) {
    improvements.push({ quote: r.original, note: 'Closed phrasing — try opening it up.', suggestion: r.rewrite });
  }
  return { strengths: strengths.slice(0,3), improvements: improvements.slice(0,3) };
}

// Tone/respect flags and double-barrel
export function detectToneFlags(turns: Turn[]) {
  const swearing = turns.some((t) => t.speaker === 'user' && /(\bfuck\b|\bshit\b|\basshole\b|\bbitch\b|\bidiot\b|\bstupid\b|\bdumb\b)/i.test(t.text));
  const hostility = turns.some((t) => t.speaker === 'user' && /(\bshut up\b|\byou (are|re) (wrong|dumb|stupid)|\bthat'?s dumb\b|\bI (hate|despise) you\b|\byou suck\b)/i.test(t.text));
  const doubleBarrel = turns.some((t) => t.speaker === 'user' && (/(\?\s*and\s*|\?.+\?)/i.test(t.text)));
  return { swearing, hostility, doubleBarrel };
}

// Missed probes (with timecodes): open Q -> short assistant (<12 words) -> next user within 15s not a follow-up
export function missedOpportunities(turns: Turn[], max = 5) {
  const misses: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const u = turns[i];
    if (u.speaker !== 'user' || !isOpen(u.text)) continue;
    const a = turns[i + 1];
    if (!a || a.speaker !== 'assistant') continue;
    const aWords = words(a.text).length;
    if (aWords >= 12) continue;
    const u2 = turns[i + 2];
    if (!u2 || u2.speaker !== 'user') continue;
    const within15s = Math.abs((u2.at || 0) - (u.at || 0)) <= 15_000;
    const isFollowUp = /\b(why|how|what|example|more|tell me more|could you)/i.test(u2.text) || isOpen(u2.text);
    if (within15s && !isFollowUp) {
      const hh = new Date(a.at).getHours().toString().padStart(2, '0');
      const mm = new Date(a.at).getMinutes().toString().padStart(2, '0');
      misses.push(`[${hh}:${mm}] Missed probe after short answer ("${a.text.slice(0, 60)}"…)`);
      if (misses.length >= max) break;
    }
  }
  return misses;
}

// Strengths
export function strengths(turns: Turn[], max = 3) {
  const s: string[] = [];
  if (turns.some((t) => t.speaker === 'user' && isRapport(t.text))) s.push('Good rapport-building.');
  if (turns.some((t, i) => t.speaker === 'user' && isOpen(t.text) && turns[i + 1]?.speaker === 'assistant')) s.push('Clear open-ended sequencing.');
  if (turns.some((t) => t.speaker === 'user' && /\b(clarify|make sure|confirm)\b/i.test(t.text))) s.push('Asked clarifying questions.');
  return s.slice(0, max);
}

export function summary(turns: Turn[]) {
  const tt = talkTimeRatio(turns);
  const oc = openVsClosed(turns);
  return [
    `Talk-time: You ${tt.userPct}% - Participant ${tt.assistantPct}%`,
    `Your questions: ${oc.open} open - ${oc.closed} closed`,
  ];
}

// Word counts
export function wordStats(turns: Turn[]) {
  const userTurns = turns.filter((t) => t.speaker === 'user');
  const asstTurns = turns.filter((t) => t.speaker === 'assistant');
  const userWords = userTurns.reduce((a, t) => a + words(t.text).length, 0);
  const asstWords = asstTurns.reduce((a, t) => a + words(t.text).length, 0);
  return {
    total: userWords + asstWords,
    user: { total: userWords, avg: userTurns.length ? Math.round(userWords / userTurns.length) : 0, turns: userTurns.length },
    assistant: { total: asstWords, avg: asstTurns.length ? Math.round(asstWords / asstTurns.length) : 0, turns: asstTurns.length },
  };
}

// Rewrites for closed questions (2 examples)
export function suggestRewrites(turns: Turn[], max = 2) {
  const out: { original: string; rewrite: string }[] = [];
  for (const t of turns) {
    if (t.speaker !== 'user') continue;
    if (!isClosed(t.text)) continue;
    const s = String(t.text || '').trim();
    const rest = s.replace(CLOSED_PREFIX, '').replace(/^\s*[:,-]?\s*/, '');
    const rewrite = `How would you describe ${rest.replace(/\?+$/, '')}?`;
    out.push({ original: s, rewrite });
    if (out.length >= max) break;
  }
  return out;
}

// Revised: compute missed opportunities with original question text
export function missedOpportunitiesV2(turns: Turn[], max = 5) {
  const misses: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const u = turns[i];
    if (u.speaker !== 'user' || !isOpen(u.text)) continue;
    const a = turns[i + 1];
    if (!a || a.speaker !== 'assistant') continue;
    const aWords = words(a.text).length;
    if (aWords >= 12) continue;
    const u2 = turns[i + 2];
    if (!u2 || u2.speaker !== 'user') continue;
    const within15s = Math.abs((u2.at || 0) - (u.at || 0)) <= 15_000;
    const isFollowUp = /\b(why|how|what|example|more|tell me more|could you)\b/i.test(u2.text) || isOpen(u2.text);
    if (within15s && !isFollowUp) {
      const hh = new Date(a.at).getHours().toString().padStart(2, '0');
      const mm = new Date(a.at).getMinutes().toString().padStart(2, '0');
      const qText = String(u.text || '').trim();
      misses.push(`[${hh}:${mm}] Missed probe: "${qText}"`);
      if (misses.length >= max) break;
    }
  }
  return misses;
}

// Revised: more concrete rewrites
export function suggestRewritesV2(turns: Turn[], max = 2) {
  const out: { original: string; rewrite: string }[] = [];
  for (const t of turns) {
    if (t.speaker !== 'user') continue;
    if (!isClosed(t.text)) continue;
    const s = String(t.text || '').trim();
    const body = s.replace(CLOSED_PREFIX, '').replace(/^\s*[:,-]?\s*/, '').replace(/\?+$/, '').trim();
    let rewrite = '';
    if (/^do you (use|have)\b/i.test(s)) {
      rewrite = `How do you ${/use\b/i.test(s) ? 'use' : 'approach'} ${body}?`;
    } else if (/^is\b/i.test(s)) {
      rewrite = `What makes ${body} difficult for you?`;
    } else if (/^(are|can|will|have|has|was|were|did|does)\b/i.test(s)) {
      rewrite = `How do you handle ${body}?`;
    } else {
      rewrite = `How would you describe ${body}?`;
    }
    out.push({ original: s, rewrite });
    if (out.length >= max) break;
  }
  return out;
}

// Revised: scoring with penalties for disrespect
export function interviewScoreV2(turns: Turn[]) {
  const tt = talkTimeRatio(turns);
  const q = questionTypeRatio(turns);
  const totalQs = q.open + q.closed + q.rapport + q.factcheck;
  // Question variety with penalty for back-to-back closed
  const openRatio = totalQs ? q.open / Math.max(1, totalQs) : 0;
  let backToBackClosed = 0;
  for (let i=1;i<turns.length;i++) {
    if (turns[i].speaker==='user' && isClosed(turns[i].text) && turns[i-1].speaker==='user' && isClosed(turns[i-1].text)) backToBackClosed += 1;
  }
  const varietyBase = openRatio;
  const varietyPenalty = Math.min(0.3, backToBackClosed * 0.05);
  const varietyScore = Math.max(0, varietyBase - varietyPenalty); // 0..1

  // Follow-up depth normalized to 3
  const depth = followUpChainDepth(turns);
  const depthScore = Math.min(1, depth / 3);

  // Talk balance: peak near 50%
  const dist = Math.min(50, Math.abs(50 - tt.userPct));
  const balanceScore = 1 - dist / 50; // 1 at 50%, 0 at 0/100

  // Civility
  const profanityEvent = turns.some(t => t.speaker === 'user' && /(\bfuck\b|\bshit\b|\basshole\b|\bbitch\b|\bidiot\b|\bstupid\b|\bdumb\b)/i.test(t.text));
  const hostilityEvent = turns.some(t => t.speaker === 'user' && /(\bI (hate|despise) you\b|\byou suck\b|\bshut up\b|\byou (are|re) (wrong|dumb|stupid))/i.test(t.text));
  const civilityScore = (profanityEvent || hostilityEvent) ? 0.2 : 1.0;

  // Interruptions per min
  let interruptCount = 0;
  for (let i = 1; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker !== 'user') continue;
    let j = i - 1; while (j >= 0 && turns[j].speaker === 'user') j--; 
    if (j >= 0 && turns[j].speaker === 'assistant') {
      const delta = Math.abs((t.at || 0) - (turns[j].at || 0));
      if (delta < 2000) interruptCount += 1;
    }
  }
  const stamps = turns.map(t=> Number(t.at)).filter(n=> Number.isFinite(n));
  const durMs = stamps.length ? Math.max(0, Math.max(...stamps) - Math.min(...stamps)) : 0;
  const mins = durMs > 0 ? (durMs / 60000) : 0;
  const ipm = mins ? (interruptCount / mins) : 0;
  const interruptScore = ipm <= 0.2 ? 1 : ipm >= 1 ? 0 : (1 - (ipm - 0.2) / 0.8);

  // Weights
  const w = { balance: 0.22, variety: 0.22, depth: 0.22, civility: 0.18, interruptions: 0.16 };
  let total = (balanceScore * w.balance + varietyScore * w.variety + depthScore * w.depth + civilityScore * w.civility + interruptScore * w.interruptions) * 100;
  if (durMs < 2*60_000) total -= 5; // short session penalty
  total = Math.max(0, Math.min(100, Math.round(total)));

  const breakdown = [
    { key: 'talkBalance', label: 'Talk Balance', value: Math.round(balanceScore * 100 * w.balance), reason: `You ${tt.userPct}% vs Participant ${tt.assistantPct}%` },
    { key: 'questionVariety', label: 'Question Variety', value: Math.round(varietyScore * 100 * w.variety), reason: `${q.open} open, ${q.closed} closed; ${backToBackClosed} back-to-back closed` },
    { key: 'followUpDepth', label: 'Follow-up Depth', value: Math.round(depthScore * 100 * w.depth), reason: `Longest chain ${depth}` },
    { key: 'toneCivility', label: 'Tone/Civility', value: Math.round(civilityScore * 100 * w.civility), reason: (profanityEvent || hostilityEvent) ? 'disrespect detected' : 'respectful' },
    { key: 'interruptions', label: 'Interruptions', value: Math.round(interruptScore * 100 * w.interruptions), reason: `${interruptCount} quick cut-ins (~${mins? ipm.toFixed(2):'0'}/min)` },
  ];
  const subs = [
    { k: 'balance', v: balanceScore },
    { k: 'variety', v: varietyScore },
    { k: 'depth', v: depthScore },
    { k: 'civility', v: civilityScore },
    { k: 'interruptions', v: interruptScore },
  ].sort((a,b)=>a.v-b.v).slice(0,2).map(x=>x.k);
  const reasonMap: Record<string,string> = { balance: 'imbalanced talk ratio', variety: 'few open follow-ups', depth: 'low depth', civility: 'tone/civility concerns', interruptions: 'frequent cut-ins' };
  const scoreReason = subs.map(k=>reasonMap[k]||k).join(' and ');
  const tooltip = 'Weights: Balance 0.22, Variety 0.22, Depth 0.22, Civility 0.18, Interruptions 0.16.';
  return { total, components: { balanceScore, varietyScore, depthScore, civilityScore, interruptScore }, breakdown, tooltip, scoreReason } as any;
}

export function buildInsightsV2(turns: Turn[]) {
  const st = strengths(turns, 3);
  const mo = missedOpportunitiesV2(turns, 5);
  const recsBase: string[] = [];
  if (mo.length) recsBase.push('Add one probe after brief answers.');
  // Short interview / low-question suggestions
  const stamps = turns.map(t=> Number(t.at)).filter(n=> Number.isFinite(n));
  const durMs = stamps.length ? Math.max(0, Math.max(...stamps) - Math.min(...stamps)) : 0;
  const userQCount = turns.filter(t => t.speaker==='user' && /\?$/.test((t.text||'').trim())).length;
  if (durMs < 2*60_000 || userQCount < 3) {
    recsBase.push('Interview felt brief—plan additional depth and follow-ups.');
  }
  const rewrites = suggestRewritesV2(turns, 2);
  const recs = recsBase.concat(rewrites.map(r => `Rewrite: \"${r.original}\" → \"${r.rewrite}\"`));
  const summaryLine = [
    ...summary(turns)
  ].join(' · ');
  const payload = { strengths: st, missed: mo, recommendations: recs, summaryLine, rewrites };
  if (process.env.NODE_ENV !== 'production') {
    if (!payload.strengths.length && !payload.missed.length && !payload.recommendations.length) {
      // eslint-disable-next-line no-console
      console.log('[report:insights-empty]', { turns: turns.length });
    }
  }
  return payload;
}

// Enriched insights (additive fields)
export function buildInsightsV3(turns: Turn[]) {
  const st = strengths(turns, 3);
  const mo = missedOpportunitiesV2(turns, 5);
  const recsBase: string[] = [];
  if (mo.length) recsBase.push('Add one probe after brief answers.');
  const stamps = turns.map(t=> Number(t.at)).filter(n=> Number.isFinite(n));
  const durMs = stamps.length ? Math.max(0, Math.max(...stamps) - Math.min(...stamps)) : 0;
  const userQCount = turns.filter(t => t.speaker==='user' && /\?$/.test((t.text||'').trim())).length;
  if (durMs < 2*60_000 || userQCount < 3) recsBase.push('Interview felt brief — plan additional depth and follow-ups.');
  const rewrites = suggestRewritesV2(turns, 2);
  const recs = recsBase.concat(rewrites.map(r => `Rewrite: "${r.original}" → "${r.rewrite}"`));
  const summaryLine = [ ...summary(turns) ].join(' · ');
  // Narrative paragraph
  const qTypes = questionTypesWithFollowUp(turns);
  const tt = talkTimeRatio(turns);
  const narrativeParts: string[] = [];
  narrativeParts.push(`You spoke ${tt.userPct}% of the time (by words).`);
  narrativeParts.push(`Questions: ${qTypes.open} open, ${qTypes.closed} closed, ${qTypes.rapport} rapport, ${qTypes.factCheck} fact-check${qTypes.followUp ? `, ${qTypes.followUp} follow-up` : ''}.`);
  if (durMs) narrativeParts.push(`Duration ~ ${formatMmSs(durMs)}.`);
  const summaryParagraph = narrativeParts.join(' ');
  const strengthsBulletPoints = st.slice(0, 3);
  const improvementBulletPoints: string[] = [];
  // Build concrete items: short quote + Try rewrite (≤ 120 chars)
  const bulletsFromRewrites = rewrites.slice(0,3).map(r => {
    const quote = `“${r.original}”`;
    const tip = `Try: ${r.rewrite}`;
    const text = `${quote} — ${tip}`;
    return text.length > 120 ? text.slice(0,117) + '…' : text;
  });
  improvementBulletPoints.push(...bulletsFromRewrites);
  if (!improvementBulletPoints.length) {
    if (qTypes.closed > qTypes.open) improvementBulletPoints.push('“(closed question)” — Try: How would you describe that experience?');
    if (mo.length) improvementBulletPoints.push('“(brief answer)” — Try: Could you share a specific example of that?');
    if (durMs < 2*60_000) improvementBulletPoints.push('“(short session)” — Try: What made that difficult for you recently?');
  }
  const nextPracticePrompts = [
    'Can you share a specific example of that?',
    'What made that challenging for you recently?',
  ];
  // Examples
  let strengthQuote = '';
  for (const t of turns) { if (t.speaker==='user' && (isOpen(t.text) || /\b(thanks|appreciate|how are you)\b/i.test(t.text||''))) { strengthQuote = t.text; break; } }
  const improvementPair = rewrites[0] ? { original: rewrites[0].original, suggested: rewrites[0].rewrite } : null;
  const examples = { strengthQuote: strengthQuote || null, improvement: improvementPair };
  const payload = { strengths: st, missed: mo, recommendations: recs, summaryLine, rewrites, narrative: { summaryParagraph }, strengthsBulletPoints, improvementBulletPoints, nextPracticePrompts, examples };
  return payload;
}

// Duration util mm:ss
export function formatMmSs(ms: number | undefined) {
  if (!ms || ms < 0) return '00:00';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Overall Score per requested weights
export function interviewScore(turns: Turn[]) {
  const tt = talkTimeRatio(turns);
  const q = questionTypeRatio(turns);
  const totalQs = q.open + q.closed + q.rapport + q.factcheck;
  const openRatio = totalQs ? q.open / totalQs : 0;
  const openScore = Math.min(1, openRatio / 0.5) * 20; // 0..20
  const balanceWithin = tt.userPct >= 35 && tt.userPct <= 65 ? 1 : Math.max(0, 1 - (Math.abs((tt.userPct < 35 ? 35 : 65) - tt.userPct) / 35));
  const balanceScore = balanceWithin * 15; // 0..15
  const misses = missedOpportunities(turns, 1000).length;
  const followScore = Math.max(0, 20 - misses * 5); // 0..20
  const flags = detectToneFlags(turns);
  const tonePenalty = (flags.swearing ? 10 : 0) + (flags.hostility ? 10 : 0) + (flags.doubleBarrel ? 5 : 0);
  const toneScore = Math.max(0, 20 - tonePenalty); // 0..20
  const rapportScore = q.rapport >= 1 ? 10 : 0; // 0..10
  const factScore = q.factcheck >= 1 ? 5 : 0; // 0..5
  const total = Math.max(0, Math.min(100, Math.round(openScore + balanceScore + followScore + toneScore + rapportScore + factScore)));
  const tooltip = 'How this is calculated: Open ratio (20) + Talk balance (15) + Follow-ups (20) + Tone/respect (20) + Rapport (10) + Fact-check (5).';
  return { total, components: { openScore: Math.round(openScore), balanceScore: Math.round(balanceScore), followScore, toneScore, rapportScore, factScore }, tooltip };
}

export function buildInsights(turns: Turn[]) {
  const st = strengths(turns, 3);
  const mo = missedOpportunities(turns, 5);
  const recsBase: string[] = [];
  if (mo.length) recsBase.push('Add one probe after brief answers.');
  const rewrites = suggestRewrites(turns, 2);
  const recs = recsBase.concat(rewrites.map(r => `Rewrite: "${r.original}" → "${r.rewrite}"`));
  const summaryLine = [
    ...summary(turns)
  ].join(' • ');
  return { strengths: st, missed: mo, recommendations: recs, summaryLine, rewrites };
}

export type AnalyticsReport = {
  talkTime: { userPct: number; assistantPct: number };
  questions: { open: number; closed: number; rapport: number; factcheck: number };
  // New additive fields: by-ms talk-time, enriched score
  score: { total: number; components: any; tooltip: string; rawTotal?: number; breakdown?: { key: string; label: string; value: number; reason: string }[]; capped?: boolean; cappedReason?: string };
  words: { total: number; user: { total: number; avg: number; turns: number }, assistant: { total: number; avg: number; turns: number } };
  flags: { swearing: boolean; hostility: boolean; doubleBarrel: boolean };
  insights: { strengths: string[]; missed: string[]; recommendations: string[]; summaryLine: string; rewrites: { original: string; rewrite: string }[]; narrative?: { summaryParagraph: string }; strengthsBulletPoints?: string[]; improvementBulletPoints?: string[]; nextPracticePrompts?: string[]; examples?: { strengthQuote: string | null; improvement: { original: string; suggested: string } | null } };
  fillers?: { user: number; assistant: number; perMinute?: { user: number; assistant: number }; top?: { word: string; count: number }[]; userTop?: { word: string; count: number }[]; assistantTop?: { word: string; count: number }[] };
  // Additive: richer talk-time and duration
  talkTimeMs?: { user: number; assistant: number; total: number; userPct: number; assistantPct: number };
  duration?: { startedAt: number; stoppedAt: number; durationMs: number; userQuestions: number };
  questionTypes?: { open: number; closed: number; rapport: number; factCheck: number; followUp: number };
  dataQuality?: { sufficient: boolean; notes: string[] };
  insightsQuotes?: { strengths: { quote: string; note: string }[]; improvements: { quote: string; note: string; suggestion?: string }[] };
  followUpChainDepth?: number;
};

export function buildAnalytics(turns: Turn[]): AnalyticsReport {
  // Fillers tally (user + assistant), strict list + isolated 'like'
  const fillers = (() => {
    const normalizeToken = (raw: string) => raw.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
    const FILLERS = new Set(['um','uh','erm','er','ah','eh','hmm','like']);
    const countFor = (speaker: 'user'|'assistant') => {
      let c = 0; const map = new Map<string, number>();
      for (const t of turns) {
        if (t.speaker !== speaker) continue;
        const tokens = String(t.text || '').split(/\s+/).filter(Boolean).map(normalizeToken);
        for (const tok of tokens) {
          if (!tok) continue;
          if (tok === 'like') { c += 1; map.set('like', (map.get('like')||0)+1); continue; }
          if (FILLERS.has(tok) && tok !== 'like') { c += 1; map.set(tok, (map.get(tok)||0)+1); }
        }
      }
      const top = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([word,count])=>({word,count}));
      return { count: c, top };
    };
    const u = countFor('user');
    const a = countFor('assistant');
    return { user: u.count, assistant: a.count, top: u.top, userTop: u.top, assistantTop: a.top };
  })();
  // Talk time in milliseconds per speaker (approx. by turn gaps)
  const talkMs = (() => {
    let user = 0, assistant = 0;
    for (let i = 0; i < turns.length - 1; i++) {
      const cur = turns[i];
      const next = turns[i+1];
      const delta = Math.max(0, Number(next.at) - Number(cur.at));
      if (cur.speaker === 'user') user += delta; else assistant += delta;
    }
    const total = user + assistant;
    const userPct = total ? Math.round((user/total)*100) : 0;
    const assistantPct = total ? Math.round((assistant/total)*100) : 0;
    return { user, assistant, total, userPct, assistantPct };
  })();
  // Expose components so the report can reason about length
  const times = (() => {
    const stamps = turns.map(t=> Number(t.at)).filter(n=> Number.isFinite(n));
    const startedAt = stamps.length ? Math.min(...stamps) : 0;
    const stoppedAt = stamps.length ? Math.max(...stamps) : 0;
    const durationMs = Math.max(0, stoppedAt - startedAt);
    const userQuestions = turns.filter(t=> t.speaker==='user' && /\?$/.test((t.text||'').trim())).length;
    return { startedAt, stoppedAt, durationMs, userQuestions };
  })();
  // Per-minute filler rates
  const perMinute = (() => {
    const mins = times.durationMs > 0 ? (times.durationMs / 60000) : 0;
    const rate = (n: number) => mins ? Number((n / mins).toFixed(2)) : 0;
    return { user: rate(fillers.user), assistant: rate(fillers.assistant) };
  })();
  (fillers as any).perMinute = perMinute;
  // Question types including follow-up
  const qTypes = questionTypesWithFollowUp(turns);
  // Score and data quality
  let score = interviewScoreV2(turns) as any;
  const dataQualityNotes: string[] = [];
  const insufficient = (turns.length < 6) || (times.durationMs < 2*60_000);
  if (turns.length < 6) dataQualityNotes.push('Fewer than 6 total turns.');
  if (times.durationMs < 2*60_000) dataQualityNotes.push('Duration under 2 minutes.');
  if (!Number.isFinite(times.durationMs) || times.durationMs === 0) dataQualityNotes.push('Duration estimated from sparse timestamps.');
  if (insufficient) {
    const capped = Math.min(40, Number(score?.total ?? 0));
    score = { ...score, total: capped, capped: true, cappedReason: 'Capped at 40 due to short session (<6 turns or <2 min).' };
  }
  const quotes = buildInsightsQuotes(turns);
  const chainDepth = followUpChainDepth(turns);
  return {
    talkTime: talkTimeRatio(turns),
    talkTimeMs: talkMs,
    duration: times,
    questionTypes: qTypes,
    questions: questionTypeRatio(turns),
    score,
    words: wordStats(turns),
    flags: detectToneFlags(turns),
    insights: buildInsightsV3(turns),
    fillers,
    dataQuality: { sufficient: !insufficient, notes: dataQualityNotes },
    insightsQuotes: quotes,
    followUpChainDepth: chainDepth,
  };
}
