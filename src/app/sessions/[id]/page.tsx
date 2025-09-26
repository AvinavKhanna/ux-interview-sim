export const dynamic = "force-dynamic";\nimport StartInterviewClient from "@/app/sessions/[id]/StartInterviewClient";
import { supabaseServer } from "@/lib/supabase";\nimport { getPersonaSummary } from "@/lib/persona/getPersonaSummary";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 15 requires awaiting params

  if (!id) {
    return <div className="p-6 text-red-600">Missing session id.</div>;
  }

    // Preload persona + project on the server so the UI shows the
  // correct summary before the user clicks Start interview.
  const sb = supabaseServer();
  let initialPersona: any | null = null;
  let initialProject: any | null = null;
  let personaSummary: any | null = null;
  try {
    const { data: session } = await sb
      .from("sessions")
      .select("id, persona_id, project_id")
      .eq("id", id)
      .single();
    if (session?.persona_id) {
      const { data: persona } = await sb
        .from("personas")
        .select("id,name,age,occupation,techfamiliarity,personality,goals,frustrations,painpoints,notes")
        .eq("id", String(session.persona_id))
        .single();
      initialPersona = persona ?? null;
      try { personaSummary = await getPersonaSummary(id); } catch {}
    }
    if (session?.project_id) {
      const { data: project } = await sb
        .from("projects")
        .select("id,title,description")
        .eq("id", String(session.project_id))
        .maybeSingle();
      initialProject = project ?? null;
    }
  } catch {}

  return <StartInterviewClient id={id} initialPersona={initialPersona} initialProject={initialProject} personaSummary={personaSummary ?? undefined} />;
}







