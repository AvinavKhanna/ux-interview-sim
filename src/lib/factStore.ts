export type FactKey = "school" | "company" | "employer" | "address" | "email" | "phone";

export class FactStore {
  private map = new Map<FactKey, string>();

  set(key: FactKey, value: string) {
    const v = value.trim();
    if (!v) return;
    this.map.set(key, v);
  }
  get(key: FactKey): string | undefined {
    return this.map.get(key);
  }
  has(key: FactKey): boolean {
    return this.map.has(key);
  }
}

const stop = /[\.;,!\n\r]/;

export function extractFactsFromText(text: string): Array<{ key: FactKey; value: string }> {
  const out: Array<{ key: FactKey; value: string }> = [];
  const t = (text || "").trim();
  if (!t) return out;
  const lines = t.split(/\n+/);
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let m: RegExpExecArray | null;

    m = /(my|the)?\s*school\s*(is|was|called)\s+(.+)/i.exec(s) || /studied\s+at\s+(.+)/i.exec(s);
    if (m) {
      const val = (m[3] || m[1] || m[0]).toString().split(stop)[0].trim();
      if (val) out.push({ key: "school", value: val });
    }

    m = /(i\s+work\s+at|my\s+company\s+is|employed\s+at)\s+(.+)/i.exec(s);
    if (m) {
      const val = (m[2] || m[0]).toString().split(stop)[0].trim();
      if (val) {
        out.push({ key: "company", value: val });
        out.push({ key: "employer", value: val });
      }
    }

    m = /(my\s+address\s+is|i\s+live\s+at)\s+(.+)/i.exec(s);
    if (m) {
      const val = (m[2] || m[0]).toString().split(stop)[0].trim();
      if (val) out.push({ key: "address", value: val });
    }

    m = /(my\s+email\s+is)\s+([^\s]+)/i.exec(s) || /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.exec(s);
    if (m) {
      const val = (m[2] || m[1]).toString().trim();
      if (val) out.push({ key: "email", value: val });
    }

    m = /(my\s+phone\s+(number\s+)?is)\s+([\d\-\s]{7,})/i.exec(s);
    if (m) {
      const val = (m[3] || m[0]).toString().split(stop)[0].trim();
      if (val) out.push({ key: "phone", value: val });
    }
  }
  return out;
}

export function buildFactGuidance(question: string, store: FactStore): { guidance: string; matched: FactKey[] } {
  const q = (question || "").toLowerCase();
  const matched: FactKey[] = [];
  if (/school|university|college/.test(q)) matched.push("school");
  if (/company|employer|work\s+at/.test(q)) matched.push("company");
  if (/address|street|road|st\.?\s/.test(q)) matched.push("address");
  if (/email|@/.test(q)) matched.push("email");
  if (/phone|number/.test(q)) matched.push("phone");

  const pieces: string[] = [];
  for (const key of matched) {
    if (!store.has(key)) {
      pieces.push("(You do not know this. Say you're not sure and ask a clarifying question; do not guess.)");
    } else {
      const val = store.get(key)!;
      pieces.push(`(Previously you said your ${key} was: ${val}.)`);
    }
  }

  return { guidance: pieces.join(" "), matched };
}

