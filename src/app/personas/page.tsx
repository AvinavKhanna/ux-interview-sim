// src/app/personas/page.tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding, mockSuggestPersonas, Persona } from '@/context/onboarding';
import { Button, Card, Page, Breadcrumb } from '@/components/UI';
import { PersonaCard } from '@/components/PersonaCard';

const STEPS = ['Project', 'Personas', 'Summary'];

export default function PersonasPage() {
  const router = useRouter();
  const { project, suggested, setSuggested, setSelected } = useOnboarding();

  // Seed suggestions if empty
  React.useEffect(() => {
    if (!suggested || suggested.length === 0) {
      const payload = { description: project?.description ?? '', genericPractice: !!project?.genericPractice };
      setSuggested(mockSuggestPersonas(payload));
    }
  }, [project, suggested, setSuggested]);

  // When user picks a persona from the list
  const pick = (p: Persona) => {
    setSelected(p);
    router.push('/sessions/summary');
  };

  // When user wants to customise
  const gotoCustomise = (p?: Persona) => {
    if (p) setSelected(p);
    router.push('/personas/customise');
  };

  return (
    <Page title="Choose a persona">
      <Breadcrumb steps={STEPS} current={1} />

      <div className="max-w-6xl mx-auto">
        {/* Persona cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {(suggested ?? []).map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              onSelect={() => pick(p)}
              onCustomise={() => gotoCustomise(p)}
            />
          ))}
        </div>

        {/* Bottom banner */}
        <Card className="mt-10 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-gray-600">
              Not seeing what you need? Customise your own persona.
            </div>
            <Button onClick={() => gotoCustomise()}>Customise your own</Button>
          </div>
        </Card>
      </div>
    </Page>
  );
}