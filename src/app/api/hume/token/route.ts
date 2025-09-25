import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { buildPrompt, deriveInitialKnobs } from "@/lib/prompt/personaPrompt";
import { chooseConfigId } from "@/lib/configChooser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  traits?: unknown;
  gender?: string | null;
  demographics?: { gender?: string | null } | null;
};

type ProjectRow = {
  title?: string | null;
  description?: string | null;
} | null;

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type CachedToken = {
  token: TokenResponse;
  usableUntil: number;
  originalExpiry: number;
};

class MissingCredentialsError extends Error {
  constructor() {
    super("Missing Hume credentials");
  }
}

class TokenRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let cachedToken: CachedToken | null = null;

function getCachedToken(): TokenResponse | null {
  if (!cachedToken) return null;
  const now = Date.now();
  if (now >= cachedToken.usableUntil) {
    cachedToken = null;
    return null;
  }
  const remaining = Math.max(0, Math.floor((cachedToken.originalExpiry - now) / 1000));
  return {
    access_token: cachedToken.token.access_token,
    token_type: cachedToken.token.token_type,
    expires_in: remaining,
  };
}

function resolveCredentials() {
  const clientId = (process.env.HUME_CLIENT_ID ?? process.env.HUME_API_KEY ?? "").trim();
  const clientSecret = (process.env.HUME_CLIENT_SECRET ?? process.env.HUME_API_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new MissingCredentialsError();
  }
  return { clientId, clientSecret };
}

async function requestFreshToken(): Promise<TokenResponse> {
  const { clientId, clientSecret } = resolveCredentials();

  const endpoints = [
    (process.env.HUME_TOKEN_URL || '').trim() || undefined,
    'https://api.hume.ai/v0/oauth2-cc/token',
    'https://api.hume.ai/v0/oauth2/token',
    'https://api.hume.ai/oauth2-cc/token',
    'https://api.hume.ai/oauth2/token',
    'https://api.hume.ai/v1/oauth2/token',
  ].filter(Boolean) as string[];

  const baseBodies: string[] = [
    'grant_type=client_credentials',
    'grant_type=client_credentials&audience=wss://api.hume.ai',
    'grant_type=client_credentials&audience=https://api.hume.ai',
    'grant_type=client_credentials&scope=evi',
  ];

  const bodiesWithCreds: string[] = [
    `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
    `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&audience=wss://api.hume.ai`,
    `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&audience=https://api.hume.ai`,
  ];

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let lastStatus = 0;
  let lastDetail = '';

  for (const url of endpoints) {
    // Try Basic auth + base bodies first
    for (const body of baseBodies) {
      try {
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
          const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          const token = typeof payload?.access_token === 'string' ? payload.access_token : undefined;
          if (token) {
            const tokenType = typeof payload?.token_type === 'string' ? (payload.token_type as string) : 'Bearer';
            const expiresSource =
              typeof payload?.expires_in === 'number'
                ? (payload.expires_in as number)
                : typeof payload?.expires_in === 'string'
                ? Number(payload.expires_in)
                : typeof (payload as any)?.expiresIn === 'number'
                ? ((payload as any).expiresIn as number)
                : 3600;
            const expiresIn = Number.isFinite(expiresSource) && expiresSource > 0 ? Math.floor(expiresSource) : 3600;
            const now = Date.now();
            const originalExpiry = now + expiresIn * 1000;
            const usableUntil = Math.max(now, originalExpiry - 30_000);
            cachedToken = {
              token: { access_token: token, token_type: tokenType, expires_in: expiresIn },
              usableUntil,
              originalExpiry,
            };
            return { access_token: token, token_type: tokenType, expires_in: expiresIn };
          }
        }
        lastStatus = res.status;
        lastDetail = await res.text().catch(() => '');
      } catch (e) {
        lastStatus = 0;
        lastDetail = 'network error';
      }
    }

    // Fallback: include creds in body without Basic header
    for (const body of bodiesWithCreds) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          cache: 'no-store',
          body,
        });
        if (res.ok) {
          const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          const token = typeof payload?.access_token === 'string' ? payload.access_token : undefined;
          if (token) {
            const tokenType = typeof payload?.token_type === 'string' ? (payload.token_type as string) : 'Bearer';
            const expiresSource =
              typeof payload?.expires_in === 'number'
                ? (payload.expires_in as number)
                : typeof payload?.expires_in === 'string'
                ? Number(payload.expires_in)
                : typeof (payload as any)?.expiresIn === 'number'
                ? ((payload as any).expiresIn as number)
                : 3600;
            const expiresIn = Number.isFinite(expiresSource) && expiresSource > 0 ? Math.floor(expiresSource) : 3600;
            const now = Date.now();
            const originalExpiry = now + expiresIn * 1000;
            const usableUntil = Math.max(now, originalExpiry - 30_000);
            cachedToken = {
              token: { access_token: token, token_type: tokenType, expires_in: expiresIn },
              usableUntil,
              originalExpiry,
            };
            return { access_token: token, token_type: tokenType, expires_in: expiresIn };
          }
        }
        lastStatus = res.status;
        lastDetail = await res.text().catch(() => '');
      } catch (e) {
        lastStatus = 0;
        lastDetail = 'network error';
      }
    }
  }

  throw new TokenRequestError(lastStatus || 502, `Hume token endpoint responded with status ${lastStatus}`);
}

async function getHumeToken(): Promise<TokenResponse> {
  const cached = getCachedToken();
  if (cached) return cached;
  return requestFreshToken();
}

function coerceList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[;,\n]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTechLevel(value: unknown): "low" | "medium" | "high" {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("low") || text.includes("novice") || text.includes("beginner")) return "low";
  if (text.includes("high") || text.includes("advanced") || text.includes("expert")) return "high";
  if (text.includes("medium") || text.includes("moderate") || text.includes("intermediate")) return "medium";
  return "medium";
}

function normalizePersonality(value: unknown): "warm" | "neutral" | "reserved" {
  const derive = (): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(String).join(" ");
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const maybe = record.personality ?? record.style ?? record.tone ?? record.mood;
      if (typeof maybe === "string") return maybe;
    }
    return "";
  };
  const text = derive().toLowerCase();
  if (text.includes("warm") || text.includes("friendly") || text.includes("open")) return "warm";
  if (text.includes("reserved") || text.includes("quiet") || text.includes("introvert")) return "reserved";
  return "neutral";
}

function normalizeGender(persona: PersonaRow): "male" | "female" | undefined {
  const raw =
    typeof persona.gender === "string" && persona.gender.trim()
      ? persona.gender
      : typeof persona.demographics?.gender === "string"
      ? persona.demographics.gender
      : undefined;
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized.startsWith("f")) return "female";
  if (normalized.startsWith("m")) return "male";
  return undefined;
}

function toPersonaKnobs(persona: PersonaRow) {
  const age = typeof persona.age === "number" && Number.isFinite(persona.age) ? persona.age : 35;
  const traitSet = new Set<string>();
  if (typeof persona.occupation === "string" && persona.occupation.trim()) {
    traitSet.add(persona.occupation.trim());
  }
  coerceList(persona.traits).forEach((trait) => traitSet.add(trait));
  coerceList(persona.goals).forEach((trait) => traitSet.add(trait));
  coerceList(persona.frustrations).forEach((trait) => traitSet.add(trait));
  coerceList(persona.painpoints).forEach((trait) => traitSet.add(trait));
  if (typeof persona.notes === "string" && persona.notes.trim()) {
    traitSet.add(persona.notes.trim());
  }

  return deriveInitialKnobs({
    age,
    traits: Array.from(traitSet),
    techFamiliarity: normalizeTechLevel(persona.techfamiliarity),
    personality: normalizePersonality(persona.personality),
    genderHint: normalizeGender(persona),
  });
}

function toProjectContext(project: ProjectRow): string {
  if (!project) return "General UX research interview.";
  const parts: string[] = [];
  if (typeof project.title === "string" && project.title.trim()) parts.push(project.title.trim());
  if (typeof project.description === "string" && project.description.trim()) parts.push(project.description.trim());
  return parts.join(" — ") || "General UX research interview.";
}

export async function POST(request: Request) {
  try {
    const { sessionId }: Body = await request.json().catch(() => ({}));
    if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

    const sb = supabaseServer();
    const { data: session, error: sessionError } = await sb
      .from("sessions")
      .select("id, persona_id, project_id")
      .eq("id", sessionId)
      .single();
    if (sessionError || !session)
      return NextResponse.json({ error: sessionError?.message ?? "Session not found" }, { status: 404 });

    const { persona_id, personaId, project_id, projectId } = session as SessionRow;
    const resolvedPersonaId = persona_id ?? personaId ?? null;
    const resolvedProjectId = project_id ?? projectId ?? null;

    const { data: personaRow, error: personaError } = await sb
      .from("personas")
      .select("id,name,age,occupation,techfamiliarity,personality,goals,frustrations,painpoints,notes,demographics")
      .eq("id", String(resolvedPersonaId ?? ""))
      .single();
    if (personaError || !personaRow)
      return NextResponse.json({ error: personaError?.message ?? "Persona not found" }, { status: 404 });

    const { data: projectRow } = await sb
      .from("projects")
      .select("id,title,description")
      .eq("id", String(resolvedProjectId ?? ""))
      .maybeSingle();

    const personaKnobs = toPersonaKnobs(personaRow as PersonaRow);
    const projectContext = toProjectContext(projectRow as ProjectRow);
    const { systemPrompt, behaviorHints } = buildPrompt({ projectContext, persona: personaKnobs });
    const configId =
      chooseConfigId(personaRow as PersonaRow) ||
      (personaKnobs.voiceConfigId !== "default" ? personaKnobs.voiceConfigId : undefined) ||
      process.env.HUME_CONFIG_ID ||
      undefined;

    const token = await getHumeToken();

    const personaSummary: PersonaRow = {
      name: personaRow.name ?? "Participant",
      age: personaRow.age ?? null,
      occupation: personaRow.occupation ?? null,
      techfamiliarity: personaRow.techfamiliarity ?? null,
      personality: personaRow.personality ?? null,
      goals: personaRow.goals ?? null,
      frustrations: personaRow.frustrations ?? null,
      painpoints: personaRow.painpoints ?? null,
      notes: personaRow.notes ?? null,
    };

    const projectSummary: ProjectRow = projectRow
      ? {
          title: projectRow.title ?? null,
          description: projectRow.description ?? null,
        }
      : null;

    return NextResponse.json({
      access_token: token.access_token,
      token_type: token.token_type,
      expires_in: token.expires_in,
      accessToken: token.access_token,
      tokenType: token.token_type,
      expiresIn: token.expires_in,
      personaPrompt: systemPrompt,
      personaName: personaSummary.name ?? "Participant",
      configId,
      persona: personaSummary,
      project: projectSummary,
      knobs: personaKnobs,
      behaviorHints,
    });
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      return NextResponse.json({ error: "Missing Hume credentials" }, { status: 400 });
    }
    if (err instanceof TokenRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 502 });
    }
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    let sessionId = String(
      url.searchParams.get('sessionId') ??
      url.searchParams.get('id') ??
      request.headers.get('x-session-id') ??
      ''
    ).trim();

    if (!sessionId) {
      const ref = request.headers.get('referer') || request.headers.get('referrer') || '';
      const match = /\/sessions\/([0-9a-fA-F\-]{16,})/.exec(ref);
      if (match && match[1]) sessionId = match[1];
    }

    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

    const sb = supabaseServer();
    const { data: session, error: sessionError } = await sb
      .from('sessions')
      .select('id, persona_id, project_id')
      .eq('id', sessionId)
      .single();
    if (sessionError || !session)
      return NextResponse.json({ error: sessionError?.message ?? 'Session not found' }, { status: 404 });

    const { persona_id, personaId, project_id, projectId } = session as SessionRow;
    const resolvedPersonaId = persona_id ?? personaId ?? null;
    const resolvedProjectId = project_id ?? projectId ?? null;

    const { data: personaRow, error: personaError } = await sb
      .from('personas')
      .select('id,name,age,occupation,techfamiliarity,personality,goals,frustrations,painpoints,notes,demographics')
      .eq('id', String(resolvedPersonaId ?? ''))
      .single();
    if (personaError || !personaRow)
      return NextResponse.json({ error: personaError?.message ?? 'Persona not found' }, { status: 404 });

    const { data: projectRow } = await sb
      .from('projects')
      .select('id,title,description')
      .eq('id', String(resolvedProjectId ?? ''))
      .maybeSingle();

    const personaKnobs = toPersonaKnobs(personaRow as PersonaRow);
    const projectContext = toProjectContext(projectRow as ProjectRow);
    const { systemPrompt, behaviorHints } = buildPrompt({ projectContext, persona: personaKnobs });
    const configId =
      chooseConfigId(personaRow as PersonaRow) ||
      (personaKnobs.voiceConfigId !== 'default' ? personaKnobs.voiceConfigId : undefined) ||
      process.env.HUME_CONFIG_ID ||
      undefined;

    const token = await getHumeToken();

    const personaSummary: PersonaRow = {
      name: personaRow.name ?? 'Participant',
      age: personaRow.age ?? null,
      occupation: personaRow.occupation ?? null,
      techfamiliarity: personaRow.techfamiliarity ?? null,
      personality: personaRow.personality ?? null,
      goals: personaRow.goals ?? null,
      frustrations: personaRow.frustrations ?? null,
      painpoints: personaRow.painpoints ?? null,
      notes: personaRow.notes ?? null,
    };

    const projectSummary: ProjectRow = projectRow
      ? {
          title: projectRow.title ?? null,
          description: projectRow.description ?? null,
        }
      : null;

    return NextResponse.json({
      access_token: token.access_token,
      token_type: token.token_type,
      expires_in: token.expires_in,
      accessToken: token.access_token,
      tokenType: token.token_type,
      expiresIn: token.expires_in,
      personaPrompt: systemPrompt,
      personaName: personaSummary.name ?? 'Participant',
      configId,
      persona: personaSummary,
      project: projectSummary,
      knobs: personaKnobs,
      behaviorHints,
    });
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      return NextResponse.json({ error: 'Missing Hume credentials' }, { status: 400 });
    }
    if (err instanceof TokenRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 502 });
    }
    const message = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


