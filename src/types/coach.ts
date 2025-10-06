export type CoachCategory =
  | "Tone"
  | "Boundary"
  | "Follow-up"
  | "Craft"
  | "Reinforcement";

export type CoachHint =
  | { kind: "probe"; text: string; category?: CoachCategory }
  | { kind: "praise"; text: string; category?: CoachCategory }
  | { kind: "boundary"; text: string; category?: CoachCategory }
  | { kind: "clarify"; text: string; category?: CoachCategory }
  | { kind: "rapport"; text: string; category?: CoachCategory };

export type CoachSample = {
  question: string;
  lastUserTurns: string[];
  lastAssistTurns: string[];
  personaKnobs?: Record<string, any>;
};

export type CoachResponse = {
  hints: CoachHint[];
};

// Detailed context provided per user turn
export type CoachContext = {
  text: string;
  ts: number; // seconds timestamp
  lastAssistant: { text: string; wordCount: number; ts: number } | null;
  lastUser: { text: string; ts: number } | null;
  persona: {
    age?: number;
    personality?: string;
    traits?: string[];
    instructions?: string;
  };
  domain: string; // session.projectDomain || "general"
  type: "open" | "closed" | "rapport" | "factcheck" | "admin";
  tone: { hostile: boolean; profanity: boolean; impatient: boolean };
  structure: { doubleBarrel: boolean; overlyLong: boolean };
};

export type CoachPolicy = {
  minGapMs: number;
  ignorePhrases: string[];
  maxHintsPerMinute: number;
};

export const DefaultCoachPolicy: CoachPolicy = {
  // Debounce per user: 8s cooldown, no queueing
  minGapMs: 8000,
  maxHintsPerMinute: 6,
  ignorePhrases: [
    "hi",
    "hello",
    "hey",
    "how are you",
    "good morning",
    "good afternoon",
  ],
};
