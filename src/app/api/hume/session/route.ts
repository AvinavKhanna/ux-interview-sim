import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { deriveInitialKnobs, buildPrompt } from '@/lib/prompt/personaPrompt';

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
    const body: Body = await request.json().catch(() => ({}));
    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

    const baseUrl = process.env.APP_BASE_URL || new URL(request.url).origin;
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

    const systemPrompt = buildPrompt(personaRow as PersonaRow, projectRow as ProjectRow, deriveInitialKnobs(personaRow as PersonaRow));

    const apiKey = process.env.HUME_API_KEY as string | undefined;
    if (!apiKey) return NextResponse.json({ error: 'HUME_API_KEY not configured' }, { status: 500 });

    const webhookUrl = `${baseUrl}/api/hume/webhook`;
    const webhookSecret = process.env.HUME_WEBHOOK_SECRET || '';

    const payload: Record<string, unknown> = {
      system_prompt: systemPrompt,
      metadata: { sessionId, personaId: resolvedPersonaId, projectId: resolvedProjectId },
      webhook_url: webhookUrl,
      webhook: { url: webhookUrl, secret: webhookSecret },
    };
    payload.systemPrompt = systemPrompt; // why: some tenants expect both naming conventions
    payload.metadata_json = payload.metadata; // why: redundancy improves compatibility with older APIs

    const candidates = [
      'https://api.hume.ai/v0/evi/conversation',
      'https://api.hume.ai/v0/evi/conversations',
      'https://api.hume.ai/v0/evi/session',
      'https://api.hume.ai/v0/evi/sessions',
      'https://api.hume.ai/v0/experimental/evi/conversation',
      'https://api.hume.ai/v0/experimental/evi/sessions',
    ];

    let json: Record<string, unknown> | null = null;
    let lastErrText = '';
    let lastStatus = 0;
    let usedUrl = '';

    for (const url of candidates) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Hume-Api-Key': apiKey,
        },
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        usedUrl = url;
        json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        break;
      }
      lastStatus = res.status;
      lastErrText = await res.text().catch(() => '');
      if (res.status !== 404) break; // why: only continue cycling endpoints on 404 (path mismatch)
    }

    if (!json) {
      return NextResponse.json({ error: 'Hume create session failed', detail: lastErrText || `status ${lastStatus}` }, { status: 502 });
    }

    const joinUrl = (json['join_url'] ?? json['joinUrl'] ?? (json['join'] as { url?: string } | undefined)?.url) as string | undefined;
    const embedToken = (json['embed_token'] ?? json['token'] ?? json['embedToken']) as string | undefined;

    if (!joinUrl && !embedToken) {
      return NextResponse.json({ error: 'Hume response missing joinUrl or token', detail: JSON.stringify(json).slice(0, 500) }, { status: 502 });
    }

    return NextResponse.json(joinUrl ? { joinUrl, endpoint: usedUrl } : { embedToken, endpoint: usedUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
