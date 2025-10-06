import { buildAnalytics, formatMmSs } from "@/lib/analysis/interview";
import ReportPollClient from "./ReportPollClient";
import type { SessionReport, Turn } from "@/types/report";

export const dynamic = "force-dynamic";

async function fetchReport(id: string): Promise<SessionReport | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || '';
    const res = await fetch(`${base}/api/sessions/${id}/report`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j.report as SessionReport;
  } catch {
    return null;
  }
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
  'use client';
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
  'use client';
  const React = require('react') as typeof import('react');
  const [q, setQ] = React.useState('');
  const filtered = q.trim() ? turns.filter(t => (t.text || '').toLowerCase().includes(q.toLowerCase())) : turns;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <input value={q} onChange={(e:any)=>setQ(e.target.value)} placeholder="Search transcript..." className="w-full max-w-sm rounded border px-2 py-1 text-sm" />
        <div className="text-xs text-gray-600">{filtered.length} / {turns.length}</div>
      </div>
      <div className="max-h[60vh] overflow-y-auto border rounded p-2 bg-white">
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

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await fetchReport(id);
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[report:loaded]', 'turns=' + String(report?.turns?.length ?? 0));
  }
  if (!report) return <ReportPollClient id={id} />;

  const analytics = buildAnalytics(report.turns);
  const meta = report.meta;
  const userTurns = analytics.words.user.turns;
  const personaTurns = analytics.words.assistant.turns;
  const userWords = analytics.words.user.total;
  const personaWords = analytics.words.assistant.total;
  const avgUserWords = analytics.words.user.avg;
  const avgPersonaWords = analytics.words.assistant.avg;
  // Fallback to transcript timestamps if meta is missing
  const ts = report.turns.map(t=> Number((t as any).startedAt ?? (t as any).at)).filter(n=> Number.isFinite(n));
  const te = report.turns.map(t=> Number((t as any).endedAt ?? (t as any).at)).filter(n=> Number.isFinite(n));
  const tsStart = ts.length ? new Date(Math.min(...ts)) : null;
  const tsStop  = te.length ? new Date(Math.max(...te)) : null;
  const started = meta.startedAt ? new Date(meta.startedAt) : tsStart;
  const stopped = meta.stoppedAt ? new Date(meta.stoppedAt) : tsStop;
  const durationMs = typeof meta.durationMs === 'number'
    ? meta.durationMs
    : (started && stopped ? (stopped.getTime() - started.getTime()) : 0);
  const durationLabel = formatMmSs(durationMs);
  const fillerUser = analytics.fillers?.user ?? 0;
  const fillerTop = analytics.fillers?.top ?? [];
  const dq = (analytics as any).dataQuality as { sufficient?: boolean; notes?: string[] } | undefined;
  const score = analytics.score as any;
  const descByKey: Record<string,string> = {
    openQuestions: 'Share of open questions',
    talkBalance: 'You vs participant talk ratio',
    followUps: 'Missed probe penalties',
    rapport: 'Rapport occurrences',
    factCheck: 'Clarifying checks',
    toneCredit: 'Baseline respectful tone',
    tonePenalty: 'Tone penalties',
    interruptions: 'Quick cut-ins penalties',
    depthPenalty: 'Short session penalties',
  };
  const summaryParagraph = ((analytics.insights as any)?.narrative?.summaryParagraph || analytics.insights.summaryLine || '') as string;
  const extraLines: string[] = [];
  if (analytics.questionTypes) {
    extraLines.push(`Follow-up questions: ${analytics.questionTypes.followUp}.`);
  }
  if (analytics.fillers?.perMinute) {
    extraLines.push(`Filler rate — You ${analytics.fillers.perMinute.user}/min, Participant ${analytics.fillers.perMinute.assistant}/min.`);
  }
  extraLines.push(`Average response length — You ${avgUserWords} words, Participant ${avgPersonaWords} words.`);
  const summaryText = `${summaryParagraph}${summaryParagraph.endsWith('.') ? '' : '.'} ${extraLines.join(' ')}`.trim();

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Interview Report</h1>
          <p className="text-sm text-gray-600">Session ID: {report.meta.id}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600 mb-1">Breakdown</div>
            <div className="space-y-2">
              {(Array.isArray(score?.breakdown) ? score.breakdown : []).map((b: any, i: number) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center justify-between">
                    <div className="text-gray-700" title={b.reason}>{b.label}</div>
                    <div className="text-gray-600">{b.value}</div>
                  </div>
                  <div className="h-2 bg-gray-200 rounded overflow-hidden">
                    <div className={"h-2 " + (b.value >= 0 ? 'bg-blue-600' : 'bg-red-400')} style={{ width: `${Math.max(0, Math.min(100, Math.abs(b.value) * 5))}%` }} />
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{descByKey[(b as any).key] || (b as any).reason}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600 mb-1">Filler Words</div>
            <div className="text-xs text-gray-700">You: {(analytics.fillers?.user ?? 0)} total{analytics.fillers?.perMinute ? ` · ${analytics.fillers.perMinute.user}/min` : ''}</div>
            <div className="text-xs text-gray-700">Participant: {(analytics.fillers?.assistant ?? 0)} total{analytics.fillers?.perMinute ? ` · ${analytics.fillers.perMinute.assistant}/min` : ''}</div>
            {(() => {
              const you = (analytics.fillers?.userTop || analytics.fillers?.top || []) as any[];
              const them = ((analytics.fillers as any)?.assistantTop || []) as any[];
              return (
                <div className="mt-1 space-y-1">
                  <div className="text-xs text-gray-600">You · Top terms: {you.length ? you.map((x:any)=>`${x.word} ${x.count}`).join(', ') : '—'}</div>
                  <div className="text-xs text-gray-600">Participant · Top terms: {them.length ? them.map((x:any)=>`${x.word} ${x.count}`).join(', ') : '—'}</div>
                </div>
              );
            })()}
          </div>
        </div>
        <Downloads report={report} />
      </header>

      {dq && dq.sufficient === false ? (
        <div className="rounded border p-4 bg-yellow-50 text-yellow-900">
          <div className="font-medium">Short session</div>
          <div className="text-sm">Scores are capped at 40 due to: {(dq.notes || []).join('; ')}</div>
        </div>
      ) : null}

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Summary</h2>
        <div className="text-sm text-gray-700 space-y-1">
          <div>Started: {started ? started.toLocaleString() : 'unknown'}</div>
          <div>Stopped: {stopped ? stopped.toLocaleString() : 'unknown'}</div>
          <div>Duration: {durationLabel}</div>
          {meta.personaSummary ? (
            <div className="mt-2 text-gray-600">Persona: {String((meta.personaSummary as any)?.name ?? 'Participant')} · {String((meta.personaSummary as any)?.techFamiliarity ?? '')} · {String((meta.personaSummary as any)?.personality ?? '')}</div>
          ) : null}
          {(meta as any)?.emotionSummary ? (
            <div className="text-xs text-gray-600">Tone (Hume): {(meta as any).emotionSummary}</div>
          ) : null}
          <p className="text-sm text-gray-700 mt-2">Session overview: {summaryText}</p>
        </div>
      </section>

      <section className="rounded border p-4 space-y-4">
        <h2 className="font-medium">Analytics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600">Talk-time</div>
            <div className="h-3 bg-gray-200 rounded overflow-hidden mt-1" title="Balance between your talk vs persona">
              <div className="h-3 bg-blue-600" style={{ width: `${analytics.talkTime.userPct}%` }} />
            </div>
            <div className="text-xs text-gray-600 mt-1">You {analytics.talkTime.userPct}% · Participant {analytics.talkTime.assistantPct}%</div>
            <div className="mt-2 text-sm flex items-center gap-2">
              <span>
                Overall Score: <span className="font-semibold" title={String(score?.tooltip || '')}>{analytics.score.total}/100</span> <abbr title={String(score?.tooltip || '')} className="text-xs text-gray-500 align-middle cursor-help">ⓘ</abbr>
              </span>
              {analytics.flags.hostility ? (
                <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700" title="Hostility detected in transcript">Respect flag</span>
              ) : null}
            </div>
          </div>
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600">Question Types</div>
            <div className="mt-1 text-xs text-gray-700">
              Open {analytics.questions.open} · Closed {analytics.questions.closed} · Rapport {analytics.questions.rapport} · Fact-check {analytics.questions.factcheck}
            </div>
            <div className="text-xs text-gray-600 mt-1">Follow-up {analytics.questionTypes ? analytics.questionTypes.followUp : 0}</div>
            {/* Depth exploration chain intentionally removed per request */}
            <div className="text-xs text-gray-600 mt-2">Avg response length: You {avgUserWords} words · Participant {avgPersonaWords} words</div>
            <div className="text-xs text-gray-600 mt-1">Turns: You {userTurns} · Participant {personaTurns}</div>
            <div className="text-xs text-gray-600 mt-1">Total words: You {userWords} · Participant {personaWords}</div>
            <div className="text-xs text-gray-600 mt-1">Fillers (you): {fillerUser}{fillerTop.length ? ` — ` : ''}{fillerTop.map(x=>`${x.word} ${x.count}`).join(', ')}</div>
          </div>
          <div className="rounded border p-3 bg-white">
            <div className="text-sm text-gray-600">Session</div>
            <div className="text-xs text-gray-700 mt-1">Duration: {durationLabel}</div>
            {started ? <div className="text-xs text-gray-700">Started: {started.toLocaleString()}</div> : null}
            {stopped ? <div className="text-xs text-gray-700">Stopped: {stopped.toLocaleString()}</div> : null}
            {meta.personaSummary ? (
              <div className="text-xs text-gray-600 mt-1">Persona: {String((meta.personaSummary as any)?.name ?? 'Participant')} · {String((meta.personaSummary as any)?.techFamiliarity ?? '')} · {String((meta.personaSummary as any)?.personality ?? '')}</div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded border p-3 bg-green-50">
            <div className="font-medium text-sm">Strengths</div>
            <p className="text-sm text-gray-800 mt-1">{(analytics.insights as any)?.narrative?.summaryParagraph || `${analytics.insights.summaryLine}.`}</p>
            <ul className="list-disc list-inside text-sm text-gray-800 mt-2">
              {analytics.insights.strengths.length ? analytics.insights.strengths.map((s,i)=>(<li key={i}>{s}</li>)) : <li>Clear, respectful tone.</li>}
              {(analytics.insights as any)?.examples?.strengthQuote ? (<li className="italic">“{(analytics.insights as any).examples.strengthQuote}”</li>) : null}
            </ul>
            {Array.isArray((analytics as any)?.insightsQuotes?.strengths) ? (
              (analytics as any).insightsQuotes.strengths.slice(0,3).map((q: any, i: number) => (
                <blockquote key={`s-${i}`} className="border-l-4 pl-3 italic text-gray-700">“{q.quote}” — {q.note}</blockquote>
              ))
            ) : null}
          </div>
          <div className="rounded border p-3 bg-amber-50">
            <div className="font-medium text-sm">Areas to Improve</div>
            <ul className="list-disc list-inside text-sm text-gray-800 mt-1">
              {((analytics.insights as any)?.improvementBulletPoints || []).map((t:string,i:number)=>(<li key={i}>{t}</li>))}
              {(analytics.insights as any)?.examples?.improvement ? (
                <li>
                  “{(analytics.insights as any).examples.improvement.original}” → <span className="font-medium">{(analytics.insights as any).examples.improvement.suggested}</span>
                </li>
              ) : null}
              {!((analytics.insights as any)?.improvementBulletPoints || []).length && !(analytics.insights as any)?.examples?.improvement ? (
                <li>Add one follow-up probe after brief answers.</li>
              ) : null}
            </ul>
            {Array.isArray((analytics as any)?.insightsQuotes?.improvements) ? (
              (analytics as any).insightsQuotes.improvements.slice(0,3).map((q: any, i: number) => (
                <blockquote key={`i-${i}`} className="border-l-4 pl-3 italic text-gray-700">“{q.quote}” — {q.note}{q.suggestion ? ` (Try: ${q.suggestion})` : ''}</blockquote>
              ))
            ) : null}
          </div>
          <div className="rounded border p-3 bg-blue-50">
            <div className="font-medium text-sm">Next Practice Prompts</div>
            <ul className="list-disc list-inside text-sm text-gray-800 mt-1">
              {(((analytics.insights as any)?.nextPracticePrompts || []) as string[]).slice(0,3).map((t,i)=>(<li key={i}>{t}</li>))}
              {!((analytics.insights as any)?.nextPracticePrompts || []).length ? (
                <>
                  <li>Can you share a specific example of that?</li>
                  <li>What made that challenging for you recently?</li>
                </>
              ) : null}
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
            // @ts-expect-error Client component within server page
            <Transcript turns={report.turns} />
          )}
        </details>
        <div className="text-xs text-gray-600 mt-2">Total words: You {userWords} · Participant {personaWords}</div>
        <div className="text-xs text-gray-600">Total turns: You {userTurns} · Participant {personaTurns}</div>
      </section>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Downloads</h2>
        <Downloads report={report} />
      </section>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Next Steps</h2>
        <p className="text-sm text-gray-700">Please complete this short feedback survey to help us improve: <a className="text-blue-600 underline" href="https://forms.gle/dA35jRAd7vQvPtNn6" target="_blank" rel="noreferrer">https://forms.gle/dA35jRAd7vQvPtNn6</a></p>
      </section>
    </div>
  );
}
