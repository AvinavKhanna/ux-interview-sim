import { supabaseServer } from '@/lib/supabase';
import { Page, Card } from '@/components/UI';
import StartInterviewClient from './StartInterviewClient';

type PersonaRow = {
  name?: string | null;
  age?: number | null;
  occupation?: string | null;
  techfamiliarity?: string | null;
  personality?: string | null;
  goals?: string[] | null;
  frustrations?: string[] | null;
  painpoints?: string[] | null;
  notes?: string | null;
};

type ProjectRow = {
  title?: string | null;
  description?: string | null;
} | null;

const toList = (value: string[] | string | null | undefined): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value.split(/[,;
]+/).map((entry) => entry.trim()).filter(Boolean);
};

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const sb = supabaseServer();

  const { data: session } = await sb
    .from('sessions')
    .select('id, persona_id, project_id')
    .eq('id', sessionId)
    .single();

  const personaId = (session as { persona_id?: string | null; personaId?: string | null } | null)?.persona_id ??
    (session as { personaId?: string | null } | null)?.personaId ??
    null;
  const projectId = (session as { project_id?: string | null; projectId?: string | null } | null)?.project_id ??
    (session as { projectId?: string | null } | null)?.projectId ??
    null;

  const { data: personaRow } = await sb
    .from('personas')
    .select('id,name,age,occupation,techfamiliarity,personality,goals,frustrations,painpoints')
    .eq('id', String(personaId ?? ''))
    .maybeSingle();

  const { data: projectRow } = await sb
    .from('projects')
    .select('id,title,description')
    .eq('id', String(projectId ?? ''))
    .maybeSingle();

  const personaData: PersonaRow | null = personaRow ? (personaRow as PersonaRow) : null;
  const projectData: ProjectRow = projectRow
    ? {
        title: (projectRow as { title?: string | null }).title ?? null,
        description: (projectRow as { description?: string | null }).description ?? null,
      }
    : null;

  const personaGoals = toList(personaData?.goals ?? null);
  const personaTraits = toList(personaData?.painpoints ?? null);

  return (
    <Page title="Session">
      <div className="space-y-6">
        <Card className="p-6">
          <div className="mb-2 text-lg font-medium">Session Context</div>
          <div className="grid gap-6 text-sm text-gray-800 lg:grid-cols-2">
            <div>
              <div className="mb-1 font-medium">Persona</div>
              {personaData ? (
                <div className="space-y-1">
                  <div>{personaData.name ?? 'Unnamed participant'}</div>
                  <div className="text-gray-600">Age {personaData.age ?? '—'} · {personaData.occupation ?? 'Participant'}</div>
                  <div className="text-gray-600">Tech: {personaData.techfamiliarity ?? '—'} · {personaData.personality ?? '—'}</div>
                  {personaGoals.length > 0 && <div className="text-gray-700">Goals: {personaGoals.slice(0, 2).join('; ')}</div>}
                  {personaTraits.length > 0 && <div className="text-gray-700">Traits: {personaTraits.slice(0, 2).join('; ')}</div>}
                </div>
              ) : (
                <div className="text-gray-500">Persona not found.</div>
              )}
            </div>
            <div>
              <div className="mb-1 font-medium">Project</div>
              {projectData ? (
                <div className="space-y-1">
                  {projectData.title && <div>{projectData.title}</div>}
                  {projectData.description && <div className="whitespace-pre-wrap text-gray-600">{projectData.description}</div>}
                </div>
              ) : (
                <div className="text-gray-500">No project attached.</div>
              )}
            </div>
          </div>
        </Card>

        <StartInterviewClient sessionId={sessionId} persona={personaData} project={projectData} />
      </div>
    </Page>
  );
}
