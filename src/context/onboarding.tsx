'use client';
import React from 'react';
import type { Persona as PersonaType, ProjectDraft as ProjectInfo, TechLevel, Personality } from '@/types';

// Re-export the Persona type so existing imports from this module keep working
export type Persona = PersonaType;

export const DEFAULT_PROJECT: ProjectInfo = {
  description: '',
  genericPractice: false,
};

export type OnboardingState = {
  project: ProjectInfo;
  suggested: Persona[];
  selected: Persona | null;
  projectId: string | null;
  setProject: (p: ProjectInfo) => void;
  setSuggested: (list: Persona[]) => void;
  setSelected: (p: Persona | null) => void;
  setProjectId: (id: string | null) => void;
};

/**
 * Mock suggestion generator — now returns the canonical Persona shape:
 *   - age: number (not in demographics)
 *   - techFamiliarity: 'low' | 'medium' | 'high'
 *   - personality: 'friendly' | 'guarded' | 'analytical' | 'impatient'
 *   - painPoints: string[]
 * Optional fields like `demographics`/`notes` are kept minimal.
 */
export function mockSuggestPersonas(p: ProjectInfo): Persona[] {
  const desc = (p.description || '').toLowerCase();
  const isBlank = !desc.trim();
  const generic = p.genericPractice || isBlank;

  if (generic) {
    return [
      {
        id: 'g1',
        name: 'Elena',
        age: 29,
        occupation: 'Freelance designer',
        techFamiliarity: 'high',
        painPoints: ['Juggling multiple tools', 'Time tracking feels clunky'],
        personality: 'friendly',
        created_at: new Date().toISOString(),
      },
      {
        id: 'g2',
        name: 'David',
        age: 46,
        occupation: 'Retail manager',
        techFamiliarity: 'medium',
        painPoints: ['POS uptime', 'Staff onboarding'],
        personality: 'analytical',
        created_at: new Date().toISOString(),
      },
      {
        id: 'g3',
        name: 'Harpreet',
        age: 60,
        occupation: 'Café owner',
        techFamiliarity: 'low',
        painPoints: ['Online orders confusion', 'Printer issues'],
        personality: 'guarded',
        created_at: new Date().toISOString(),
      },
    ];
  }

  // Simple project-aware tweaks based on keywords
  const mentions = (kw: string) => desc.includes(kw);
  const mobile = mentions('mobile') || mentions('app');
  const banking = mentions('bank') || mentions('finance') || mentions('2fa') || mentions('verification');

  return [
    {
      id: 's1',
      name: 'Irene',
      age: 68,
      occupation: 'Retired teacher',
      techFamiliarity: 'low',
      painPoints: [
        banking ? 'Two-factor codes are confusing' : 'Password resets feel risky',
        mobile ? 'Small text on mobile' : 'Unclear navigation labels',
      ],
      personality: 'friendly',
      demographics: { location: 'Sydney' },
      created_at: new Date().toISOString(),
    },
    {
      id: 's2',
      name: 'Paul',
      age: 35,
      occupation: 'Shift worker',
      techFamiliarity: 'medium',
      painPoints: [
        mobile ? 'Wants quick balance checks' : 'Wants faster access to key tasks',
        'Hates long forms',
      ],
      personality: 'impatient',
      created_at: new Date().toISOString(),
    },
    {
      id: 's3',
      name: 'Aditi',
      age: 41,
      occupation: 'Accountant',
      techFamiliarity: 'high',
      painPoints: [
        banking ? 'Exporting statements' : 'Exporting data',
        'Advanced search',
      ],
      personality: 'analytical',
      created_at: new Date().toISOString(),
    },
  ];
}

// ---- context ----
const Ctx = React.createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = React.useState<ProjectInfo>(DEFAULT_PROJECT);
  const [suggested, setSuggested] = React.useState<Persona[]>([]);
  const [selected, setSelected] = React.useState<Persona | null>(null);
  const [projectId, setProjectId] = React.useState<string | null>(null);

  const value = React.useMemo(
    () => ({ project, suggested, selected, projectId, setProject, setSuggested, setSelected, setProjectId }),
    [project, suggested, selected, projectId]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return v;
}
