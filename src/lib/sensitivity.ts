export type SensitivityOptions = {
  boundaries: string[];
  cautiousness: number; // 0..1
  openness: number; // 0..1
  trustTurnsSeen: number; // # of user turns so far
  trustWarmupTurns: number; // N over which openness increases
};

export type SensitivityScore = {
  level: "low" | "medium" | "high";
  hesitationMs: number;
  maxSentences: number;
  discloseProb: number; // 0..1
  matchedKeys: string[]; // e.g., ["school","company"]
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function containsWord(q: string, w: string) {
  return new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(q);
}

function detectSpecifics(q: string): string[] {
  const keys: string[] = [];
  const lc = q.toLowerCase();
  if (/school|university|college/.test(lc)) keys.push("school");
  if (/company|employer|work(?:\s+at)?/.test(lc)) keys.push("company");
  if (/address|street|st\.?\s|road|rd\.?\s|avenue|ave\.?\s/.test(lc)) keys.push("address");
  if (/email|@/.test(lc)) keys.push("email");
  if (/phone|\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/.test(lc)) keys.push("phone");
  if (/which|what|when|where|who/.test(lc)) keys.push("specific");
  if (/\d/.test(q)) keys.push("digits");
  return keys;
}

export function scoreQuestion(question: string, opts: SensitivityOptions): SensitivityScore {
  const q = question || "";
  const lc = q.toLowerCase();
  const boundaryHit = opts.boundaries.some((b) => b && lc.includes(String(b).toLowerCase()));
  const specifics = detectSpecifics(q);

  let risk = 0;
  if (boundaryHit) risk += 2.0;
  risk += specifics.length * 0.5;
  if (containsWord(lc, "why")) risk += 0.3; // probing

  // Trust reduces risk gradually across warmup turns
  const warmup = Math.max(1, opts.trustWarmupTurns || 4);
  const trustFactor = clamp01(opts.trustTurnsSeen / warmup);
  risk -= 0.8 * trustFactor * (opts.openness ?? 0.5);

  // Cautiousness increases perceived risk slightly
  risk += 0.5 * (opts.cautiousness ?? 0.6);

  // Clamp and map to levels
  risk = Math.max(0, Math.min(4, risk));
  let level: "low" | "medium" | "high";
  if (risk >= 2.5) level = "high"; else if (risk >= 1.2) level = "medium"; else level = "low";

  // Hesitation scaling by cautiousness
  const bases = { low: 200, medium: 500, high: 900 } as const;
  const scale = 0.7 + 0.6 * clamp01(opts.cautiousness ?? 0.6);
  const hesitationMs = Math.round(bases[level] * scale);

  const maxSentences = level === "high" ? 2 : level === "medium" ? 3 : 4;

  // Probability of disclosing specifics goes down with risk, up with openness/trust
  let discloseProb = 0.8 - 0.15 * risk + 0.15 * clamp01(opts.openness ?? 0.5) + 0.15 * trustFactor;
  discloseProb = clamp01(discloseProb);

  return { level, hesitationMs, maxSentences, discloseProb, matchedKeys: specifics };
}

