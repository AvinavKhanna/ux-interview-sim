'use client';
import * as React from 'react';
import type { SessionReport, Turn } from '@/types/report';
import { talkTimeRatio, openVsClosed, summary, buildAnalytics, missedOpportunities } from '@/lib/analysis/interview';

function fmt(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toTxt(turns: Turn[]) {
  return turns.map((t) => `${fmt(t.at)} [${t.speaker}] ${t.text}`).join('\n');
}

function toCsv(turns: Turn[]) {
  const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const rows = turns.map((t) => `${t.at},${t.speaker},${esc(t.text)}`);
  return `timestamp,speaker,text\n${rows.join('\n')}`;
}

function dl(name: string, mime: string, data: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Downloads({ report }: { report: SessionReport }) {
  const json = JSON.stringify(report, null, 2);
  const txt = toTxt(report.turns);
  const csv = toCsv(report.turns);
  const printPdf = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Transcript ${report.meta.id}</title>
    <style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;}
    h1{font-size:18px;margin:0 0 8px;} p{margin:4px 0;} .line{margin:4px 0; white-space:pre-wrap;}</style></head>
    <body><h1>Interview Transcript</h1>
    <p>Session: ${report.meta.id}</p>
    <p>Started: ${report.meta.startedAt ? new Date(report.meta.startedAt).toLocaleString() : ''}</p>
    <p>Stopped: ${report.meta.stoppedAt ? new Date(report.meta.stoppedAt).toLocaleString() : ''}</p>
    <hr/>
    ${report.turns.map(t=>`<div class="line">[${fmt(t.at)}] <strong>${t.speaker==='user'?'You':'Participant'}:</strong> ${String(t.text).replace(/</g,'&lt;')}</div>`).join('')}
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(()=>{ try { w.focus(); w.print(); } catch {} }, 250);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button className="px-2 py-1 rounded border" onClick={() => dl(`session-${report.meta.id}.txt`, 'text/plain', txt)}>Download TXT</button>
      <button className="px-2 py-1 rounded border" onClick={printPdf}>Save as PDF</button>
      <button className="px-2 py-1 rounded border" onClick={() => dl(`session-${report.meta.id}.json`, 'application/json', json)}>Download JSON</button>
      <button className="px-2 py-1 rounded border" onClick={() => dl(`session-${report.meta.id}.csv`, 'text/csv', csv)}>Download CSV</button>
    </div>
  );
}

function Transcript({ turns }: { turns: Turn[] }) {
  const [q, setQ] = React.useState('');
  const filtered = q.trim() ? turns.filter(t => (t.text || '').toLowerCase().includes(q.toLowerCase())) : turns;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search transcript..." className="w-full max-w-sm rounded border px-2 py-1 text-sm" />
        <div className="text-xs text-gray-600">{filtered.length} / {turns.length}</div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto border rounded p-2 bg-white">
        <ul className="text-sm space-y-2">
          {filtered.map((t, i) => (
            <li key={i} className={t.speaker === 'user' ? 'text-right' : 'text-left'}>
              <span className="inline-block rounded px-2 py-1 bg-gray-100">[{fmt(t.at)}] {t.speaker === 'user' ? 'You' : 'Participant'}: {t.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ReportPollClient({ id }: { id: string }) {
  const [loading, setLoading] = React.useState(true);
  const [report, setReport] = React.useState<SessionReport | null>(null);
  const [attempts, setAttempts] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sessions/${id}/report`, { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          if (alive && j?.report) { setReport(j.report as SessionReport); setLoading(false); return; }
        }
        try {
          const raw = localStorage.getItem(`reportLocal:${id}`);
          if (raw) {
            const local = JSON.parse(raw) as SessionReport;
            if (local && Array.isArray(local.turns) && local.turns.length) {
              setReport(local);
              setLoading(false);
              return;
            }
          }
        } catch {}
      } catch {}
      if (alive && attempts < 12) {
        setAttempts((n) => n + 1);
        setTimeout(tick, 800);
      } else {
        setLoading(false);
      }
    };
    tick();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (loading) return <div className="p-6 text-gray-600">Preparing report… retrying</div>;
  if (!report) return <div className="p-6 text-red-600">Report not found. The transcript may not have been saved. Try stopping again or check the /stop call.</div>;

  const tt = talkTimeRatio(report.turns);
  const oc = openVsClosed(report.turns);
  const lines = summary(report.turns);
  const analytics = buildAnalytics(report.turns);
  const userTurns = report.turns.filter(t=>t.speaker==='user');
  const personaTurns = report.turns.filter(t=>t.speaker==='assistant');
  const wc = (s: string)=> (s||'').trim().split(/\s+/).filter(Boolean).length;
  const userWords = userTurns.reduce((a,t)=>a+wc(t.text),0);
  const personaWords = personaTurns.reduce((a,t)=>a+wc(t.text),0);
  const avgUserWords = userTurns.length ? Math.round(userWords/userTurns.length) : 0;
  const avgPersonaWords = personaTurns.length ? Math.round(personaWords/personaTurns.length) : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Interview Report</h1>
          <p className="text-sm text-gray-600">Session ID: {report.meta.id}</p>
        </div>
        <Downloads report={report} />
      </header>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Summary</h2>
        <div className="text-sm text-gray-700 space-y-1">
          <div>Started: {report.meta.startedAt ? new Date(report.meta.startedAt).toLocaleString() : 'unknown'}</div>
          <div>Stopped: {report.meta.stoppedAt ? new Date(report.meta.stoppedAt).toLocaleString() : 'unknown'}</div>
          <div>Duration: {typeof report.meta.durationMs === 'number' ? Math.round(report.meta.durationMs/1000) + 's' : 'unknown'}</div>
          <p className="text-sm text-gray-700 mt-2">Session overview: {lines.join(' ')}</p>
        </div>
      </section>

      <section className="rounded border p-4 space-y-4">
        <h2 className="font-medium">Analytics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600">Talk-time</div>
            <div className="h-3 bg-gray-200 rounded overflow-hidden mt-1">
              <div className="h-3 bg-blue-600" style={{ width: `${analytics.talkTime.userPct}%` }} />
            </div>
            <div className="text-xs text-gray-600 mt-1">You {analytics.talkTime.userPct}% – Participant {analytics.talkTime.assistantPct}%</div>
            <div className="mt-2 text-sm">Overall Score: <span className="font-semibold">{analytics.score.total}/100</span></div>
          </div>
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600">Question Types</div>
            <div className="mt-1 text-xs text-gray-700">
              Open {analytics.questions.open} · Closed {analytics.questions.closed} · Rapport {analytics.questions.rapport} · Fact-check {analytics.questions.factcheck}
            </div>
            <div className="text-xs text-gray-600 mt-2">Avg length: You {avgUserWords}w · Participant {avgPersonaWords}w</div>
            <div className="text-xs text-gray-600 mt-1">Turns: You {userTurns.length} · Participant {personaTurns.length}</div>
          </div>
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600">Insights</div>
            <div className="text-xs text-gray-700 mt-1">Summary: {analytics.insights.paragraph}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded border p-3 bg-green-50">
            <div className="font-medium text-sm">✅ Strengths</div>
            <ul className="list-disc list-inside text-sm text-gray-800 mt-1">
              {analytics.insights.strengths.length ? analytics.insights.strengths.map((s,i)=>(<li key={i}>{s}</li>)) : <li>Clear, respectful tone.</li>}
            </ul>
          </div>
          <div className="rounded border p-3 bg-amber-50">
            <div className="font-medium text-sm">⚠️ Missed Opportunities</div>
            <ul className="list-disc list-inside text-sm text-gray-800 mt-1">
              {missedOpportunities(report.turns, 5).map((t,i)=>(<li key={i}>{t}</li>))}
            </ul>
          </div>
          <div className="rounded border p-3 bg-blue-50">
            <div className="font-medium text-sm">💡 Recommendations</div>
            <ul className="list-disc list-inside text-sm text-gray-800 mt-1">
              <li>Try reframing closed questions to be open-ended.</li>
              <li>Probe deeper when the persona hesitates.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Transcript</h2>
        <details open>
          <summary className="cursor-pointer text-sm text-gray-600">Show / Hide transcript</summary>
          {(!report.turns || report.turns.length === 0) ? (
            <div className="text-sm text-red-600">Transcript is missing. If you stopped the interview abruptly, the final transcript may not have been saved.</div>
          ) : (
            <Transcript turns={report.turns} />
          )}
        </details>
        <div className="text-xs text-gray-600 mt-2">Total words: You {userWords} · Participant {personaWords}</div>
        <div className="text-xs text-gray-600">Total turns: You {userTurns.length} · Participant {personaTurns.length}</div>
      </section>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Next Steps</h2>
        <p className="text-sm text-gray-700">Please complete this short feedback survey to help us improve: <a className="text-blue-600 underline" href="https://forms.gle/dA35jRAd7vQvPtNn6" target="_blank" rel="noreferrer">https://forms.gle/dA35jRAd7vQvPtNn6</a></p>
      </section>
    </div>
  );
}

