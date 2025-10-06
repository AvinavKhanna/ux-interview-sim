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
  const openRatio = totalQs ? q.open / Math.max(1, totalQs) : 0;
  const openScore = Math.min(1, openRatio / 0.5) * 20; // 0..20, target >=50%
  const balanceWithin = tt.userPct >= 35 && tt.userPct <= 65 ? 1 : Math.max(0, 1 - (Math.abs((tt.userPct < 35 ? 35 : 65) - tt.userPct) / 35));
  const balanceScore = balanceWithin * 15; // 0..15
  const misses = missedOpportunitiesV2(turns, 1000).length;
  const followScore = Math.max(0, 20 - misses * 5); // 0..20
  const rapportScore = q.rapport >= 1 ? 10 : 0; // 0..10
  const factScore = q.factcheck >= 1 ? 5 : 0; // 0..5

  // Tone/respect penalties
  const profanityEvent = turns.some(t => t.speaker === 'user' && /(\bfuck\b|\bshit\b|\basshole\b|\bbitch\b|\bidiot\b|\bstupid\b|\bdumb\b)/i.test(t.text));
  const hostilityEvent = turns.some(t => t.speaker === 'user' && /(\bI (hate|despise) you\b|\byou suck\b|\bshut up\b|\byou (are|re) (wrong|dumb|stupid))/i.test(t.text));
  const tonePenalty = Math.min(60, (profanityEvent ? 30 : 0) + (hostilityEvent ? 30 : 0));
  // Repeated interruptions: user turn within <2s of last assistant ts, at least twice
  let interruptCount = 0;
  for (let i = 1; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker !== 'user') continue;
    let j = i - 1;
    while (j >= 0 && turns[j].speaker === 'user') j--;
    if (j >= 0 && turns[j].speaker === 'assistant') {
      const delta = Math.abs((t.at || 0) - (turns[j].at || 0));
      if (delta < 2000) interruptCount += 1;
    }
  }
  const interruptPenalty = interruptCount >= 2 ? 10 : 0;

  // Duration / session depth penalties (short interviews or very few questions)
  const stamps = turns.map(t=> Number(t.at)).filter(n=> Number.isFinite(n));
  const durMs = stamps.length ? Math.max(0, Math.max(...stamps) - Math.min(...stamps)) : 0;
  const userQCount = turns.filter(t => t.speaker==='user' && /\?$/.test((t.text||'').trim())).length;
  let depthPenalty = 0;
  if (durMs < 2 * 60_000) depthPenalty += 10; // <2m
  if (userQCount < 3) depthPenalty += 10;      // <3 questions

  const positives = openScore + balanceScore + followScore + rapportScore + factScore; // up to 70
  const toneBase = 30; // respectful tone credit
  const rawTotal = positives + (toneBase - tonePenalty) - interruptPenalty - depthPenalty;
  const total = Math.max(0, Math.min(100, Math.round(rawTotal)));
  const tooltip = 'Score is weighted from open-ratio, talk balance, follow-ups, tone/respect, rapport, fact-check.';
  return { total, components: { openScore: Math.round(openScore), balanceScore: Math.round(balanceScore), followScore: Math.round(followScore), rapportScore, factScore, tonePenalty, interruptPenalty }, tooltip };
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
  score: { total: number; components: any; tooltip: string };
  words: { total: number; user: { total: number; avg: number; turns: number }, assistant: { total: number; avg: number; turns: number } };
  flags: { swearing: boolean; hostility: boolean; doubleBarrel: boolean };
  insights: { strengths: string[]; missed: string[]; recommendations: string[]; summaryLine: string; rewrites: { original: string; rewrite: string }[] };
  fillers?: { user: number; assistant: number; top: { word: string; count: number }[] };
};

export function buildAnalytics(turns: Turn[]): AnalyticsReport {
  // Fillers tally (user + assistant), keep a short top list for user
  const fillers = (() => {
    const tally = (speaker: 'user'|'assistant') => {
      const re = /(\bum\b|\buh\b|\blike\b|\byou know\b|\bsort of\b|\bkind of\b|\bbasically\b|\bactually\b|\bi mean\b)/gi;
      let c = 0; const map = new Map<string, number>();
      for (const t of turns) {
        if (t.speaker !== speaker) continue;
        const m = String(t.text || '').toLowerCase().match(re) || [];
        c += m.length; for (const w of m) map.set(w, (map.get(w) || 0) + 1);
      }
      const top = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([word,count])=>({word,count}));
      return { count: c, top };
    };
    const u = tally('user');
    const a = tally('assistant');
    return { user: u.count, assistant: a.count, top: u.top };
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
  return {
    talkTime: talkTimeRatio(turns),
    questions: questionTypeRatio(turns),
    score: interviewScoreV2(turns),
    words: wordStats(turns),
    flags: detectToneFlags(turns),
    insights: buildInsightsV2(turns),
    fillers,
  };
}
