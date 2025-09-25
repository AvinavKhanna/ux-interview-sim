'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

export default function ReportPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [report, setReport] = useState<any>(null);
  const [turns, setTurns] = useState<any[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string| null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: t } = await sb
        .from('turns')
        .select('role,text,created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      setTurns(t || []);

      // Build transcript the summariser expects
      const transcript = (t || []).map((row: any) => ({
        who: row.role === 'user' ? 'student' : 'persona',
        text: row.text || '',
      }));

      // get summarizer output
      const r = await fetch('/api/summarise-session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ transcript }) });
      const json = await r.json();
      setReport(json);

      // signed URL for audio if present
      const s = await sb.from('sessions').select('audio_url').eq('id', sessionId).single();
      if (s.data?.audio_url) {
        const signed = await sb.storage.from('audio').createSignedUrl(s.data.audio_url, 60*60); // 1h
        setDownloadUrl(signed.data?.signedUrl || null);
      }
    })();
  }, [sessionId]);

  const exportCsv = () => {
    const rows = [['timestamp','who','text'], ...(turns||[]).map((t:any)=>[t.ts, t.who, t.text.replace(/\n/g,' ')])];
    const csv = rows.map(r=>r.map(x=>`"${String(x||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `session-${sessionId}.csv` });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Session Report</h1>
      {downloadUrl && (
        <a className="text-sm underline" href={downloadUrl} target="_blank">Download session audio</a>
      )}
      <button onClick={exportCsv} className="w-fit border px-3 py-2 rounded text-sm">Export CSV</button>

      {!report ? <div>Analyzing…</div> : (
        <div className="grid gap-4">
          <section className="bg-white border rounded p-3">
            <div className="font-medium mb-2">Key moments</div>
            <ul className="list-disc pl-5 text-sm">{report.key_moments?.map((m:string,i:number)=><li key={i}>{m}</li>)}</ul>
          </section>
          <section className="bg-white border rounded p-3">
            <div className="font-medium mb-2">Missed opportunities</div>
            <ul className="list-disc pl-5 text-sm">{report.missed_opportunities?.map((m:string,i:number)=><li key={i} title="Flagged based on best-practice rubric">{m}</li>)}</ul>
          </section>
          <section className="bg-white border rounded p-3 grid gap-2">
            <div className="font-medium">Question types</div>
            <div className="text-sm">
              {Object.entries(report.question_type_counts||{}).map(([k,v])=>(
                <div key={k} className="flex items-center gap-2">
                  <div className="w-28">{k}</div>
                  <div className="h-2 bg-slate-200 rounded flex-1">
                    <div className="h-2 bg-slate-800 rounded" style={{ width: `${Number(v)*12}px` }} />
                  </div>
                  <div className="w-6 text-right">{v as any}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="bg-white border rounded p-3">
            <div className="font-medium mb-2">Tone shifts</div>
            <ul className="list-disc pl-5 text-sm">{report.tone_shift_notes?.map((m:string,i:number)=><li key={i}>{m}</li>)}</ul>
          </section>
          <section className="bg-white border rounded p-3">
            <div className="font-medium mb-2">3 improvement tips</div>
            <ul className="list-disc pl-5 text-sm">{report.tips?.map((m:string,i:number)=><li key={i}>{m}</li>)}</ul>
          </section>
        </div>
      )}
    </div>
  );
}
