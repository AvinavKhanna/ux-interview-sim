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
  const userChars = turns.filter((t) => t.speaker === 'user').reduce((a, t) => a + (t.text || '').length, 0);
  const asstChars = turns.filter((t) => t.speaker === 'assistant').reduce((a, t) => a + (t.text || '').length, 0);
  const total = Math.max(1, userChars + asstChars);
  return { userPct: Math.round((userChars / total) * 100), assistantPct: Math.round((asstChars / total) * 100) };
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
  const swearing = turns.some((t) => t.speaker === 'user' && /(fuck|shit|damn|bitch|bastard|idiot|stupid)/i.test(t.text));
  const hostility = turns.some((t) => t.speaker === 'user' && /(shut up|you are (wrong|dumb|stupid)|that'?s dumb)/i.test(t.text));
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
};

export function buildAnalytics(turns: Turn[]): AnalyticsReport {
  return {
    talkTime: talkTimeRatio(turns),
    questions: questionTypeRatio(turns),
    score: interviewScore(turns),
    words: wordStats(turns),
    flags: detectToneFlags(turns),
    insights: buildInsights(turns),
  };
}
