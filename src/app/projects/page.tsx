'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding, mockSuggestPersonas } from '@/context/onboarding';
import { Button, Card, Labeled, Page, RadioCard, TextArea, Breadcrumb } from '@/components/UI';
import { supabaseBrowser } from '@/lib/supabase';
import { mapSuggestionsToPersonas } from '@/lib/mapSuggestions';

type Mode = 'project' | 'practice';

function deriveTitle(text: string) {
  const first = text.split(/[.!?\n]/)[0]?.trim();
  return first?.length ? first.slice(0, 80) : 'Untitled Project';
}

export default function ProjectPage() {
  const router = useRouter();
  const { project, setProject, setSuggested, setSelected, setProjectId } = useOnboarding();

  const [mode, setMode] = React.useState<Mode>(
    project.genericPractice ? 'practice' : 'project'
  );
  const [desc, setDesc] = React.useState(project.description || '');
  const [loading, setLoading] = React.useState(false);

  async function next() {
    if (mode === 'practice') {
      const payload = { description: '', genericPractice: true };
      setProject(payload);
      setSelected(null);
      setProjectId(null);
      // keep mock for practice mode (no description context)
      setSuggested(mockSuggestPersonas(payload));
      router.push('/personas');
      return;
    }

    if (desc.trim().length < 5) return;
    setLoading(true);
    try {
      // 1) Save project directly with supabaseBrowser (you already have this client)
      const { data, error } = await supabaseBrowser()
        .from('projects')
        .insert([{ title: deriveTitle(desc), description: desc, domain_tags: [] }])
        .select()
        .single();

      if (error) {
        alert(error.message || 'Failed to save project');
        return;
      }

      // Put the minimal shape into context (as your code expects)
      const ctxProject = { description: data?.description ?? desc, genericPractice: false };
      setProject(ctxProject);
      setSelected(null);
      if (data?.id) setProjectId(data.id);

      // 2) Ask OpenAI for suggestions via your API
      const res = await fetch('/api/suggest-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc.trim() }),
      });

      let suggestions: any[] = [];
      if (res.ok) {
        suggestions = await res.json().catch(() => []);
      } else {
        // fail-soft: keep going with mocks if API fails
        console.warn('suggest-persona failed', await res.text());
      }

      const mapped = mapSuggestionsToPersonas(suggestions, desc);
      setSuggested(mapped.length ? mapped : mockSuggestPersonas(ctxProject));

      // 3) Go to Personas step
      router.push('/personas');
    } finally {
      setLoading(false);
    }
  }

  const canContinue = mode === 'practice' || (mode === 'project' && desc.trim().length > 4);

  return (
    <Page title="Tell us about your project or interview goal">
      <Breadcrumb
        steps={['Project', 'Personas', 'Summary']}
        current={0}
        linkMap={{
          Project: '/projects',
          Personas: '/personas',
          Summary: '/sessions/summary',
        }}
      />
      <div className="grid md:grid-cols-2 gap-6">
        <RadioCard
          title="I have a project"
          desc="Describe your product or research goal and we’ll suggest relevant personas."
          selected={mode === 'project'}
          onClick={() => setMode('project')}
        />
        <RadioCard
          title="Practice mode"
          desc="No specific product. Get varied, general-purpose personas to train your interviewing."
          selected={mode === 'practice'}
          onClick={() => setMode('practice')}
        />
      </div>

      {mode === 'project' && (
        <Card className="mt-6 p-4">
          <Labeled label="Project / Goal">
            <TextArea
              placeholder='Example: “I’m designing a mobile banking app for seniors.”'
              value={desc}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDesc(e.target.value)}
            />
          </Labeled>
        </Card>
      )}

      <div className="flex gap-2 mt-6">
        <Button onClick={next} disabled={!canContinue || loading}>
          {loading ? 'Saving…' : 'Next →'}
        </Button>
        <Button variant="ghost" onClick={() => router.push('/') }>
          Back
        </Button>
      </div>
    </Page>
  );
}

