export type SummaryInput = {
  durationMs: number;
  talkRatio: { interviewer: number; participant: number }; // 0..1
  interruptionsPerMin: number;
  followupDepth: number; // max chain length
};

function mmss(ms: number): string {
  if (!ms || ms < 0) return '00:00';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function pct(n: number): number {
  const x = Math.max(0, Math.min(1, n));
  return Math.round(x * 100);
}

export function buildInterviewSummary(s: SummaryInput): string {
  const dur = mmss(Math.max(0, s.durationMs || 0));
  const you = pct(s.talkRatio.interviewer || 0);
  const them = pct(s.talkRatio.participant || 0);
  const balanced = you >= 40 && you <= 60 && them >= 40 && them <= 60;
  const leader = you > them ? 'you led' : 'participant led';
  const sentence1 = `Duration ${dur}; talk ${balanced ? 'balanced' : leader} (${you}% vs ${them}%).`;

  const ipm = Number(isFinite(s.interruptionsPerMin as any) ? s.interruptionsPerMin : 0);
  const interruptBand = ipm <= 0.05 ? 'none' : ipm <= 0.6 ? 'occasional' : 'frequent';
  const depthWord = s.followupDepth >= 3 ? 'meaningful' : s.followupDepth <= 1 ? 'limited' : 'moderate';
  const sentence2 = `Interruptions ${interruptBand}; depth ${depthWord}.`;

  // Weakest metric suggestion
  const weaknesses: Array<{ key: string; score: number; text: string }> = [
    { key: 'balance', score: balanced ? 1 : 0, text: you > 65 ? 'Aim for more open prompts to reduce your talk share.' : them > 65 ? 'Guide with open prompts so they share more.' : '' },
    { key: 'interruptions', score: ipm <= 0.2 ? 1 : ipm <= 0.6 ? 0.6 : 0.2, text: 'Pause 1–2s after answers to avoid cut-ins.' },
    { key: 'depth', score: s.followupDepth >= 3 ? 1 : s.followupDepth >= 2 ? 0.6 : 0.2, text: 'Add one follow-up like “What made that difficult?”' },
  ];
  weaknesses.sort((a, b) => a.score - b.score);
  const suggestion = weaknesses[0].text;
  const parts = [sentence1, sentence2].filter(Boolean);
  if (suggestion) parts.push(suggestion);
  let out = parts.join(' ');
  if (out.length > 240) out = out.slice(0, 237).replace(/\s+\S*$/, '') + '...';
  return out;
}

