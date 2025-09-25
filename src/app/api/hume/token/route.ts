import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { deriveInitialKnobs, buildPrompt } from '@/lib/prompt/personaPrompt';
import { chooseConfigId } from '@/lib/configChooser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = { sessionId?: string };

type SessionRow = {
  persona_id?: string | null;
  personaId?: string | null;
  project_id?: string | null;
  projectId?: string | null;
};

type PersonaRow = {
  name?: string | null;
  age?: number | null;
  occupation?: string | null;
  techfamiliarity?: string | null;
  personality?: unknown;
  goals?: unknown;
  frustrations?: unknown;
  painpoints?: unknown;
  notes?: unknown;
};

type ProjectRow = {
  title?: string | null;
  description?: string | null;
} | null;

export async function POST(request: Request) {
  try {
    const { sessionId }: Body = await request.json().catch(() => ({}));
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

    const sb = supabaseServer();
    const { data: session, error: sessionError } = await sb
      .from('sessions')
      .select('id, persona_id, project_id')
      .eq('id', sessionId)
      .single();
    if (sessionError || !session) return NextResponse.json({ error: sessionError?.message ?? 'Session not found' }, { status: 404 });

    const { persona_id, personaId, project_id, projectId } = session as SessionRow;
    const resolvedPersonaId = persona_id ?? personaId ?? null;
    const resolvedProjectId = project_id ?? projectId ?? null;

    const { data: personaRow, error: personaError } = await sb
      .from('personas')
      .select('id,name,age,occupation,techfamiliarity,personality,goals,frustrations,painpoints,notes')
      .eq('id', String(resolvedPersonaId ?? ''))
      .single();
    if (personaError || !personaRow) return NextResponse.json({ error: personaError?.message ?? 'Persona not found' }, { status: 404 });

    const { data: projectRow } = await sb
      .from('projects')
      .select('id,title,description')
      .eq('id', String(resolvedProjectId ?? ''))
      .maybeSingle();

    const knobs = deriveInitialKnobs(personaRow as PersonaRow);
    const systemPrompt = buildPrompt(personaRow as PersonaRow, projectRow as ProjectRow, knobs);
    const configId = chooseConfigId(personaRow as PersonaRow) || process.env.HUME_CONFIG_ID || undefined;

    const key = process.env.HUME_API_KEY;
    const secret = process.env.HUME_API_SECRET;
    if (!key || !secret) return NextResponse.json({ error: 'HUME_API_KEY/HUME_API_SECRET not configured' }, { status: 500 });

    const basicAuth = Buffer.from(`${key}:${secret}`).toString('base64');
    const endpoints = [
      'https://api.hume.ai/v0/oauth2-cc/token',
      'https://api.hume.ai/v0/oauth2/token',
      'https://api.hume.ai/oauth2-cc/token',
      'https://api.hume.ai/oauth2/token',
      'https://api.hume.ai/v1/oauth2/token',
    ];
    const bodies = [
      'grant_type=client_credentials',
      'grant_type=client_credentials&audience=wss://api.hume.ai',
      'grant_type=client_credentials&audience=https://api.hume.ai',
      'grant_type=client_credentials&scope=evi',
      `grant_type=client_credentials&client_id=${encodeURIComponent(key)}&client_secret=${encodeURIComponent(secret)}`,
      `grant_type=client_credentials&client_id=${encodeURIComponent(key)}&client_secret=${encodeURIComponent(secret)}&audience=wss://api.hume.ai`,
    ];

    let responseJson: Record<string, unknown> | null = null;
    let lastStatus = 0;
    let lastDetail = '';
    let usedEndpoint = '';

    for (const url of endpoints) {
      for (const body of bodies) {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
          },
          cache: 'no-store',
          body,
        });
        if (res.ok) {
          usedEndpoint = url;
          responseJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          break;
        }
        lastStatus = res.status;
        lastDetail = await res.text().catch(() => '');
      }
      if (responseJson) break;
    }

    if (!responseJson) {
      return NextResponse.json({ error: 'Failed to get access token', detail: lastDetail || `status ${lastStatus}` }, { status: 502 });
    }

    const accessToken = (responseJson['access_token'] ?? responseJson['token'] ?? responseJson['accessToken']) as string | undefined;
    if (!accessToken) return NextResponse.json({ error: 'Invalid token response' }, { status: 502 });

    const personaSummary: PersonaRow = {
      name: (personaRow as PersonaRow).name ?? 'Participant',
      age: (personaRow as PersonaRow).age ?? null,
      occupation: (personaRow as PersonaRow).occupation ?? null,
      techfamiliarity: (personaRow as PersonaRow).techfamiliarity ?? null,
      personality: (personaRow as PersonaRow).personality ?? null,
      goals: (personaRow as PersonaRow).goals ?? null,
      frustrations: (personaRow as PersonaRow).frustrations ?? null,
      painpoints: (personaRow as PersonaRow).painpoints ?? null,
      notes: (personaRow as PersonaRow).notes ?? null,
    };

    const projectSummary: ProjectRow = projectRow
      ? {
          title: (projectRow as ProjectRow)?.title ?? null,
          description: (projectRow as ProjectRow)?.description ?? null,
        }
      : null;

    return NextResponse.json({
      accessToken,
      personaPrompt: systemPrompt,
      personaName: personaSummary.name ?? 'Participant',
      configId,
      persona: personaSummary,
      project: projectSummary,
      knobs,
      endpoint: usedEndpoint,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
