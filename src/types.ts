// src/types.ts
// Single source of truth for app types

// Shared unions
export type TechLevel = 'low' | 'medium' | 'high';
export type Personality = 'friendly' | 'guarded' | 'analytical' | 'impatient';

// DB-friendly models
export type Project = {
  id: string;              // uuid
  title: string;
  description: string;
  genericPractice: boolean;
  created_at: string;      // timestamp
  user_id?: string | null; // for Phase 3 auth
};

export type Persona = {
  id: string;              // uuid
  name: string;
  age: number;
  occupation: string;
  techFamiliarity: TechLevel;
  painPoints: string[];    // keep as array in app; store as text[] in PG
  personality?: Personality;
  notes?: string;
  // Optional fields we may add in Phase 4
  traits?: string[];
  goals?: string[];
  frustrations?: string[];
  demographics?: Record<string, string | number | boolean>;
  created_at: string;      // timestamp
  user_id?: string | null; // for Phase 3 auth
};

export type TranscriptTurn = {
  who: 'student' | 'persona';
  text: string;
  at?: string; // ISO timestamp (optional)
};

export type Session = {
  id: string;               // uuid
  projectId: string;        // fk -> projects.id
  personaId: string;        // fk -> personas.id
  transcript: TranscriptTurn[];
  feedback?: any;           // JSON blob returned by /api/interview or /api/cues
  created_at: string;       // timestamp
  user_id?: string | null;  // for Phase 3 auth
};

// Small helper types for forms
export type ProjectDraft = Pick<Project, 'description' | 'genericPractice'>;
export type PersonaDraft = Omit<Persona, 'id' | 'created_at' | 'user_id'>;
export type SessionDraft = Omit<Session, 'id' | 'created_at' | 'user_id'>;