'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

type Row = { id: string; name?: string; title?: string };

export default function NewSessionPage() {
  const [personas, setPersonas] = useState<Row[]>([]);
  const [projects, setProjects] = useState<Row[]>([]);
  const [personaId, setPersonaId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: p } = await sb.from('personas').select('id,name').order('created_at', { ascending: false });
      const { data: pr } = await sb.from('projects').select('id,title').order('created_at', { ascending: false });
      setPersonas(p || []);
      setProjects(pr || []);
    })();
  }, []);

  const start = async () => {
    setLoading(true);
    const sb = supabaseBrowser();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { alert('Please log in first.'); setLoading(false); return; }
    if (!personaId || !projectId) { alert('Choose a persona and a project.'); setLoading(false); return; }

    const { data, error } = await sb.from('sessions')
      .insert({ user_id: auth.user.id, persona_id: personaId, project_id: projectId })
      .select('id')
      .single();

    setLoading(false);
    if (error) { alert(error.message); return; }
    router.push(`/sessions/${data!.id}`);
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">New Session</h1>

      <div className="bg-white p-4 rounded border grid gap-3">
        <label className="text-sm font-medium">Persona</label>
        <select className="border p-2 rounded" value={personaId} onChange={e=>setPersonaId(e.target.value)}>
          <option value="">Select…</option>
          {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label className="text-sm font-medium">Project</label>
        <select className="border p-2 rounded" value={projectId} onChange={e=>setProjectId(e.target.value)}>
          <option value="">Select…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>

        <button
          onClick={start}
          disabled={loading}
          className="bg-black text-white px-3 py-2 rounded w-fit"
        >
          {loading ? 'Starting…' : 'Start Session'}
        </button>
      </div>
    </div>
  );
}
