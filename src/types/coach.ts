export type CoachHint =
  | { kind: "probe"; text: string }
  | { kind: "praise"; text: string }
  | { kind: "boundary"; text: string }
  | { kind: "clarify"; text: string }
  | { kind: "rapport"; text: string };

export type CoachSample = {
  question: string;
  lastUserTurns: string[];
  lastAssistTurns: string[];
  personaKnobs?: Record<string, any>;
};

export type CoachResponse = {
  hints: CoachHint[];
};

export type CoachPolicy = {
  minGapMs: number;
  ignorePhrases: string[];
  maxHintsPerMinute: number;
};

export const DefaultCoachPolicy: CoachPolicy = {
  minGapMs: 7000,
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

