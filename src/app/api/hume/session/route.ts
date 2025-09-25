import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { buildPrompt, deriveInitialKnobs } from "@/lib/prompt/personaPrompt";

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

const toStringList = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[;,\n]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeTechLevel = (value: unknown): "low" | "medium" | "high" => {
  const textValue = String(value ?? "").toLowerCase();
  if (textValue.includes("low") || textValue.includes("novice") || textValue.includes("beginner")) return "low";
  if (textValue.includes("high") || textValue.includes("advanced") || textValue.includes("expert")) return "high";
  if (textValue.includes("medium") || textValue.includes("moderate") || textValue.includes("intermediate")) return "medium";
  return "medium";
};

const normalizePersonalityTone = (value: unknown): "warm" | "neutral" | "reserved" => {
  const derive = (): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(String).join(" ");
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const fields = ["personality", "style", "tone", "mood", "summary"];
      for (const field of fields) {
        if (typeof record[field] === "string") return record[field] as string;
      }
    }
    return "";
  };
  const lowered = derive().toLowerCase();
  if (lowered.includes("warm") || lowered.includes("friendly") || lowered.includes("open")) return "warm";
  if (lowered.includes("reserved") || lowered.includes("quiet") || lowered.includes("introvert")) return "reserved";
  return "neutral";
};

const inferGenderHint = (persona: PersonaRow): "male" | "female" | undefined => {
  const fromPersona = typeof persona.gender === "string" && persona.gender.trim() ? persona.gender : undefined;
  const fromDemo = (() => {
    if (!persona.demographics || typeof persona.demographics !== "object") return undefined;
    const record = persona.demographics as Record<string, unknown>;
    const raw = record.gender;
    return typeof raw === "string" && raw.trim() ? raw : undefined;
  })();
  const raw = fromPersona ?? fromDemo;
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized.startsWith("f")) return "female";
  if (normalized.startsWith("m")) return "male";
  return undefined;
};

const composeProjectContext = (project: ProjectRow): string => {
  if (!project) return "General UX research interview.";
  const parts: string[] = [];
  if (typeof project.title === "string" && project.title.trim()) parts.push(project.title.trim());
  if (typeof project.description === "string" && project.description.trim()) parts.push(project.description.trim());
  return parts.join(" — ") || "General UX research interview.";
};

const buildPersonaKnobs = (persona: PersonaRow) => {
  const age = typeof persona.age === "number" && Number.isFinite(persona.age) ? persona.age : 35;
  const traits = new Set<string>();
  if (typeof persona.occupation === "string" && persona.occupation.trim()) traits.add(persona.occupation.trim());
  toStringList(persona.traits).forEach((entry) => traits.add(entry));
  toStringList(persona.goals).forEach((entry) => traits.add(entry));
  toStringList(persona.frustrations).forEach((entry) => traits.add(entry));
  toStringList(persona.painpoints).forEach((entry) => traits.add(entry));
  if (typeof persona.notes === "string" && persona.notes.trim()) traits.add(persona.notes.trim());

  return deriveInitialKnobs({
    age,
    traits: Array.from(traits),
    techFamiliarity: normalizeTechLevel(persona.techfamiliarity),
    personality: normalizePersonalityTone(persona.personality),
    genderHint: inferGenderHint(persona),
  });
};

export async function POST(request: Request) {
  try {
    const body: Body = await request.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

    const baseUrl = process.env.APP_BASE_URL || new URL(request.url).origin;
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
      .select("id,name,age,occupation,techfamiliarity,personality,goals,frustrations,painpoints,notes,gender,demographics")
      .eq("id", String(resolvedPersonaId ?? ""))
      .single();
    if (personaError || !personaRow)
      return NextResponse.json({ error: personaError?.message ?? "Persona not found" }, { status: 404 });

    const { data: projectRow } = await sb
      .from("projects")
      .select("id,title,description")
      .eq("id", String(resolvedProjectId ?? ""))
      .maybeSingle();

    const personaKnobs = buildPersonaKnobs(personaRow as PersonaRow);
    const { systemPrompt, behaviorHints } = buildPrompt({
      projectContext: composeProjectContext(projectRow as ProjectRow),
      persona: personaKnobs,
    });

    const apiKey = process.env.HUME_API_KEY as string | undefined;
    if (!apiKey) return NextResponse.json({ error: "HUME_API_KEY not configured" }, { status: 500 });

    const webhookUrl = `${baseUrl}/api/hume/webhook`;
    const webhookSecret = process.env.HUME_WEBHOOK_SECRET || "";

    const metadata = {
      sessionId,
      personaId: resolvedPersonaId,
      projectId: resolvedProjectId,
      knobs: personaKnobs,
      behaviorHints,
    };

    const payload: Record<string, unknown> = {
      system_prompt: systemPrompt,
      metadata,
      webhook_url: webhookUrl,
      webhook: { url: webhookUrl, secret: webhookSecret },
    };
    payload.systemPrompt = systemPrompt;
    payload.metadata_json = metadata;
    payload.behavior_hints = behaviorHints;

    const candidates = [
      "https://api.hume.ai/v0/evi/conversation",
      "https://api.hume.ai/v0/evi/conversations",
      "https://api.hume.ai/v0/evi/session",
      "https://api.hume.ai/v0/evi/sessions",
      "https://api.hume.ai/v0/experimental/evi/conversation",
      "https://api.hume.ai/v0/experimental/evi/sessions",
    ];

    let json: Record<string, unknown> | null = null;
    let lastErrText = "";
    let lastStatus = 0;
    let usedUrl = "";

    for (const url of candidates) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Hume-Api-Key": apiKey,
        },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        usedUrl = url;
        json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        break;
      }
      lastStatus = res.status;
      lastErrText = await res.text().catch(() => "");
      if (res.status !== 404) break;
    }

    if (!json) {
      return NextResponse.json(
        { error: "Hume create session failed", detail: lastErrText || `status ${lastStatus}` },
        { status: 502 }
      );
    }

    const joinUrl = (json["join_url"] ?? json["joinUrl"] ?? (json["join"] as { url?: string } | undefined)?.url) as
      | string
      | undefined;
    const embedToken = (json["embed_token"] ?? json["token"] ?? json["embedToken"]) as string | undefined;

    if (!joinUrl && !embedToken) {
      return NextResponse.json(
        { error: "Hume response missing joinUrl or token", detail: JSON.stringify(json).slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json(joinUrl ? { joinUrl, endpoint: usedUrl } : { embedToken, endpoint: usedUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

