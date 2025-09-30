// src/app/sessions/summary/page.tsx
'use client';
import * as React from 'react';
import { normalizePersonaSummary } from '@/lib/persona/normalize';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/context/onboarding';
import { Button, Card, Page, Breadcrumb } from '@/components/UI';

const STEPS = ['Project', 'Personas', 'Summary'];

function deriveTitle(text?: string) {
  if (!text) return 'Untitled Project';
  const first = text.split(/[.!?\n]/)[0]?.trim();
  return first?.length ? first.slice(0, 80) : 'Untitled Project';
}

export default function SummaryPage() {
  const router = useRouter();
  const { project, selected, projectId } = useOnboarding();
  const [starting, setStarting] = React.useState(false);

  const description = project?.description?.trim() ?? '';
  const title = deriveTitle(description);
  const showTitle = title && title !== description;

  async function startInterview() {
    if (!selected) return alert('Choose or create a persona first.');
    setStarting(true);
    try {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[persona:post]', { name: selected.name, age: selected.age, techFamiliarity: selected.techFamiliarity, personality: selected.personality });
      }
      const summary = normalizePersonaSummary(selected as any);
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ projectId: projectId ?? undefined, personaId: selected.id, persona: selected, personaSummary: summary }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to start session');
        return;
      }
      try { localStorage.setItem(`personaSummary:${data.id}`, JSON.stringify(summary)); } catch {}
      router.push(`/sessions/${data.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Page title="Summary">
      <Breadcrumb
        steps={['Project', 'Personas', 'Summary']}
        current={2}
        linkMap={{
          Project: '/projects',
          Personas: '/personas',
          Summary: '/sessions/summary',
        }}
      />

      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-lg font-medium mb-2">Project</h3>
            {project?.genericPractice ? (
              <p className="text-sm text-gray-600">Generic Practice</p>
            ) : project ? (
              <>
                {showTitle && <div className="text-sm text-gray-700 font-medium">{title}</div>}
                {description && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{description}</p>}
              </>
            ) : (
              <p className="text-sm text-gray-500">No project set.</p>
            )}
            <div className="mt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push('/projects')}
              >
                Edit Project
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-medium mb-2">Persona</h3>
            {selected ? (
              <div className="text-sm text-gray-700">
                <div className="font-medium">{selected.name || 'Unnamed'}</div>
                <div className="text-gray-600">
                  Age {selected.age ?? '—'} • {selected.techFamiliarity ?? '—'} tech • {selected.personality ?? '—'}
                </div>
                <div className="text-gray-600">
                  Occupation: {selected.occupation?.trim() || 'Participant'}
                </div>
                {Array.isArray(selected.painPoints) && selected.painPoints.length > 0 && (
                  <ul className="mt-2 list-disc list-inside">
                    {selected.painPoints.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No persona selected.</p>
            )}
            <div className="mt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push(selected ? '/personas/customise' : '/personas')}
              >
                Edit Persona
              </Button>
            </div>
          </Card>
        </div>

        <div className="mt-8 flex justify-center">
          <Button
            type="button"
            onClick={startInterview}
            disabled={starting || !selected}
          >
            {starting ? 'Starting…' : 'Start Interview'}
          </Button>
        </div>
      </div>
    </Page>
  );
}
