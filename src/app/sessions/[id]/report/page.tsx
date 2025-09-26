import { talkTimeRatio, openVsClosed, summary } from "@/lib/analysis/interview";
import type { SessionReport, Turn } from "@/types/report";

export const dynamic = "force-dynamic";

async function fetchReport(id: string): Promise<SessionReport | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/sessions/${id}/report`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j.report as SessionReport;
  } catch {
    return null;
  }
}

function formatTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString();
}

function fmt(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toTxt(turns: Turn[]) {
  return turns.map((t) => `${fmt(t.at)} [${t.speaker}] ${t.text}`).join("\n");
}

function toCsv(turns: Turn[]) {
  const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const rows = turns.map((t) => `${t.at},${t.speaker},${esc(t.text)}`);
  return `timestamp,speaker,text\n${rows.join("\n")}`;
}

function dl(name: string, mime: string, data: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Downloads({ report }: { report: SessionReport }) {
  'use client';
  const json = JSON.stringify(report, null, 2);
  const txt = toTxt(report.turns);
  const csv = toCsv(report.turns);
  return (
    <div className="flex gap-2">
      <button className="px-2 py-1 rounded border" onClick={() => dl(`session-${report.meta.id}.txt`, 'text/plain', txt)}>Download TXT</button>
      <button className="px-2 py-1 rounded border" onClick={() => dl(`session-${report.meta.id}.json`, 'application/json', json)}>Download JSON</button>
      <button className="px-2 py-1 rounded border" onClick={() => dl(`session-${report.meta.id}.csv`, 'text/csv', csv)}>Download CSV</button>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await fetchReport(id);
  if (!report) return <div className="p-6">No report found.</div>;
  const tt = talkTimeRatio(report.turns);
  const oc = openVsClosed(report.turns);
  const lines = summary(report.turns);
  const meta = report.meta;
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Interview Report</h1>
          <p className="text-sm text-gray-600">Session ID: {meta.id}</p>
        </div>
        <Downloads report={report} />
      </header>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Summary</h2>
        <div className="text-sm text-gray-700 space-y-1">
          <div>Started: {meta.startedAt ? formatTime(meta.startedAt) : 'unknown'}</div>
          <div>Stopped: {meta.stoppedAt ? formatTime(meta.stoppedAt) : 'unknown'}</div>
          <div>Duration: {typeof meta.durationMs === 'number' ? Math.round(meta.durationMs/1000) + 's' : 'unknown'}</div>
          {meta.personaSummary ? (
            <div className="mt-2 text-gray-600">Persona: {String(meta.personaSummary?.name ?? 'Participant')} • {String(meta.personaSummary?.techFamiliarity ?? 'tech')} • {String(meta.personaSummary?.personality ?? 'personality')}</div>
          ) : null}
        </div>
      </section>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Analytics</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 mb-3">
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="mb-1">Talk-time</div>
            <div className="h-3 bg-gray-200 rounded overflow-hidden">
              <div className="h-3 bg-blue-600" style={{ width: `${tt.userPct}%` }} />
            </div>
            <div className="text-xs text-gray-600 mt-1">You {tt.userPct}% • Participant {tt.assistantPct}%</div>
          </div>
          <div>
            <div className="mb-1">Your questions</div>
            <div className="h-3 bg-gray-200 rounded overflow-hidden">
              <div className="h-3 bg-indigo-500" style={{ width: `${(oc.open + oc.closed) ? (oc.open/(oc.open+oc.closed))*100 : 0}%` }} />
            </div>
            <div className="text-xs text-gray-600 mt-1">Open {oc.open} • Closed {oc.closed}</div>
          </div>
        </div>
      </section>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Transcript</h2>
        <ul className="text-sm space-y-2">
          {report.turns.map((t, i) => (
            <li key={i} className={t.speaker === 'user' ? 'text-right' : 'text-left'}>
              <span className="inline-block rounded px-2 py-1 bg-gray-100">[{fmt(t.at)}] {t.speaker === 'user' ? 'You' : 'Participant'}: {t.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

