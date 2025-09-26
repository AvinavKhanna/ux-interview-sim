export type EmotionPair = { name: string; score: number };

// Extracts top-3 emotion scores from a variety of possible shapes
// seen in Hume EVI messages. Tolerant to different key paths.
export function extractEmotions(msg: unknown): EmotionPair[] {
  try {
    const results: EmotionPair[] = [];

    const clamp01 = (n: unknown): number => {
      const v = typeof n === "string" ? Number(n) : (n as number);
      if (!Number.isFinite(v)) return 0;
      // If scores are 0..100, normalize to 0..1
      const norm = v > 1 && v <= 100 ? v / 100 : v;
      return Math.min(1, Math.max(0, norm));
    };

    const push = (name: unknown, score: unknown) => {
      const n = String(name ?? "").trim();
      if (!n) return;
      const s = clamp01(score);
      if (s > 0) results.push({ name: n, score: s });
    };

    const collectFrom = (value: unknown) => {
      if (!value) return;
      if (Array.isArray(value)) {
        // Array of { name, score } or tuples
        for (const item of value) {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const keyName = (obj.name ?? obj.label ?? obj.key ?? obj.id) as unknown;
            const keyScore = (obj.score ?? obj.value ?? obj.confidence ?? obj.probability) as unknown;
            if (keyName != null && keyScore != null) push(keyName, keyScore);
          } else if (Array.isArray(item) && item.length >= 2) {
            push(item[0], item[1]);
          }
        }
        return;
      }
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        // Object map: { emotionName: number }
        const entries = Object.entries(obj);
        let numericCount = 0;
        for (const [, v] of entries) if (typeof v === "number") numericCount++;
        if (numericCount >= Math.min(3, entries.length)) {
          for (const [k, v] of entries) push(k, v);
          return;
        }
        // Known shapes
        collectFrom(obj.scores);
        collectFrom(obj.emotions);
        collectFrom(obj.affect);
        collectFrom(obj.predictions);
        collectFrom(obj.output);
        // Nested common paths
        collectFrom((obj.models as any)?.prosody);
        collectFrom((obj.message as any)?.models?.prosody);
        collectFrom((obj.message as any)?.metadata?.emotions);
        return;
      }
    };

    collectFrom(msg);

    // If nothing found, try a few direct paths conservatively
    if (!results.length && msg && typeof msg === "object") {
      const root = msg as Record<string, unknown>;
      collectFrom(root.models);
      collectFrom(root.message);
      collectFrom(root.data);
    }

    // Deduplicate by highest score per name
    const byName = new Map<string, number>();
    for (const r of results) byName.set(r.name, Math.max(byName.get(r.name) ?? 0, r.score));
    const unique = Array.from(byName.entries()).map(([name, score]) => ({ name, score }));
    unique.sort((a, b) => b.score - a.score);
    return unique.slice(0, 3);
  } catch {
    return [];
  }
}

