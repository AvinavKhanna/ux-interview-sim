'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding, mockSuggestPersonas, Persona } from '@/context/onboarding';
import { Button, Card, Page, Breadcrumb } from '@/components/UI';
import { PersonaCard } from '@/components/PersonaCard';
import { mapSuggestionsToPersonas } from '@/lib/mapSuggestions';

export default function PersonasPage() {
  const router = useRouter();
  const { project, suggested, setSuggested, setSelected } = useOnboarding();
  const [loading, setLoading] = React.useState(false);

  // If user landed here directly, keep UX sane
  React.useEffect(() => {
    if (!project) router.replace('/projects');
  }, [project, router]);

  // Seed suggestions if empty:
  React.useEffect(() => {
    const run = async () => {
      if (!project || (suggested && suggested.length > 0)) return;

      // Try API first if we have a description and it's not generic-practice
      if (project.description && !project.genericPractice) {
        setLoading(true);
        try {
          const res = await fetch('/api/suggest-persona', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: project.description }),
          });
          let list: any[] = [];
          if (res.ok) list = await res.json().catch(() => []);
          const mapped = mapSuggestionsToPersonas(list, project?.description);
          if (mapped.length) {
            setSuggested(mapped);
            return;
          }
        } finally {
          setLoading(false);
        }
      }
      // Fallback to mock
      setSuggested(mockSuggestPersonas({ description: project?.description ?? '', genericPractice: !!project?.genericPractice }));
    };
    run();
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
      <Breadcrumb
        steps={['Project', 'Personas', 'Summary']}
        current={1}
        linkMap={{
          Project: '/projects',
          Personas: '/personas',
          Summary: '/sessions/summary',
        }}
      />

      <div className="max-w-6xl mx-auto">
        {loading && (
          <Card className="mb-6 p-4 text-sm text-gray-600">Generating suggestions…</Card>
        )}

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