export type Turn = { speaker: "user" | "assistant"; text: string; at: number };
export type SessionMeta = { id: string; startedAt: number; stoppedAt?: number; personaSummary?: any; durationMs?: number };
export type SessionReport = { meta: SessionMeta; turns: Turn[] };

