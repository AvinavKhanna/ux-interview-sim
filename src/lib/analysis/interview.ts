import type { Turn } from "@/types/report";

const isQ = (t: string) => /\?$/.test(t.trim());
const isOpen = (t: string) => /^(how|what|why|describe|tell me|can you tell|walk me)/i.test(t.trim());

export function talkTimeRatio(turns: Turn[]) {
  const userChars = turns.filter((t) => t.speaker === "user").reduce((a, t) => a + t.text.length, 0);
  const asstChars = turns.filter((t) => t.speaker === "assistant").reduce((a, t) => a + t.text.length, 0);
  const total = Math.max(1, userChars + asstChars);
  return { userPct: Math.round((userChars / total) * 100), assistantPct: Math.round((asstChars / total) * 100) };
}

export function openVsClosed(turns: Turn[]) {
  const qs = turns.filter((t) => t.speaker === "user" && isQ(t.text)).map((t) => t.text);
  const open = qs.filter(isOpen).length;
  return { open, closed: Math.max(0, qs.length - open) };
}

// Simple missed-opportunities: short assistant answer after user's open Q, with no follow-up probe
export function missedOpportunities(turns: Turn[], max = 3) {
  const tips: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker === "user" && isOpen(t.text)) {
      const a = turns[i + 1];
      const u2 = turns[i + 2];
      if (a?.speaker === "assistant" && a.text.split(/\s+/).length <= 12 && (!u2 || u2.speaker !== "user" || !isOpen(u2.text))) {
        tips.push("Probe deeper after a brief answer (e.g., \"Can you give an example?\").");
        if (tips.length >= max) break;
      }
    }
  }
  return tips;
}

export function strengths(turns: Turn[], max = 3) {
  const s: string[] = [];
  const rapport = turns.some((t) => t.speaker === "user" && /(thanks|appreciate|great to|no worries|how are you)/i.test(t.text));
  if (rapport) s.push("Good rapport-building.");
  const seq = turns.some((t, i) => t.speaker === "user" && isOpen(t.text) && turns[i + 1]?.speaker === "assistant");
  if (seq) s.push("Clear open-ended sequencing.");
  const clarify = turns.some((t) => t.speaker === "user" && /(could you clarify|help me understand|what do you mean)/i.test(t.text));
  if (clarify) s.push("Asked clarifying questions.");
  return s.slice(0, max);
}

export function summary(turns: Turn[]) {
  const tt = talkTimeRatio(turns);
  const oc = openVsClosed(turns);
  const lines = [
    `Talk-time: You ${tt.userPct}% — Participant ${tt.assistantPct}%`,
    `Your questions: ${oc.open} open — ${oc.closed} closed`,
  ];
  const mo = missedOpportunities(turns, 2);
  if (mo.length) lines.push(...mo);
  const st = strengths(turns, 2);
  if (st.length) lines.push(...st);
  return lines;
}

export { isQ, isOpen };

