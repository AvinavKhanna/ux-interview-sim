import type { SessionReport } from "@/types/report";

const mem = new Map<string, SessionReport>();

export const SessionStore = {
  get(id: string) {
    return mem.get(id) || null;
  },
  set(id: string, r: SessionReport) {
    mem.set(id, r);
  },
  upsert(id: string, patch: Partial<SessionReport>) {
    const cur = mem.get(id) || ({ meta: { id, startedAt: Date.now() }, turns: [] } as SessionReport);
    const next = { ...cur, ...patch, meta: { ...cur.meta, ...(patch.meta || {}) } } as SessionReport;
    mem.set(id, next);
    return next;
  },
};

