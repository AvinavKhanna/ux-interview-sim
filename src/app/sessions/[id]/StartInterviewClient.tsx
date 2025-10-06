"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPrompt, deriveInitialKnobs } from "@/lib/prompt/personaPrompt";
import type { PersonaSummary } from "@/types/persona";
import { extractEmotions } from "@/lib/emotions";
import { scoreQuestion } from "@/lib/sensitivity";
import { FactStore, extractFactsFromText, buildFactGuidance } from "@/lib/factStore";
import EmotionStrip from "@/app/sessions/[id]/EmotionStrip";
import type { CoachResponse, CoachSample } from "@/types/coach";
import { diffPersona } from "@/lib/debug/personaDiff";
import {
  VoiceClient,
  createSocketConfig,
  base64ToBlob,
  arrayBufferToBlob,
  getSupportedMimeType,
  type AudioMessage,
  type JSONMessage,
} from "@humeai/voice";

type Props = { id: string; initialPersona?: any | null; initialProject?: any | null; personaSummary?: PersonaSummary };

type ConnectState = "idle" | "fetching-token" | "connecting" | "connected" | "error";

type EmotionPair = { name: string; score: number };

type Turn = {
  id: string;
  role: "user" | "persona";
  text: string;
  at: string;
  meta?: { emotions?: EmotionPair[] };
};

declare global {
  interface Window {
    __HUME_SAMPLE__?: unknown;
  }
}

export default function StartInterviewClient({ id, initialPersona, initialProject, personaSummary }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ConnectState>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("Ready.");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [emotionFeed, setEmotionFeed] = useState<{ at: number; items: EmotionPair[] }[]>([]);
  // Default ON to make hints visible without extra clicks
  const [coachEnabled, setCoachEnabled] = useState<boolean>(true);
  const [coachHint, setCoachHint] = useState<string | null>(null);
  const [coachSeverity, setCoachSeverity] = useState<'info'|'nudge'|'important'>('nudge');
  const lastCoachAtRef = useRef<number>(0);
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const factStoreRef = useRef(new FactStore());
  const turnsSeenRef = useRef(0);
  // Resolved from the token route (real selected persona/project)
  const [serverPrompt, setServerPrompt] = useState<string | null>(null);
  const [serverPersona, setServerPersona] = useState<any | null>(initialPersona ?? null);
  const [serverProject, setServerProject] = useState<any | null>(initialProject ?? null);
  const [summary, setSummary] = useState<PersonaSummary | undefined>(personaSummary);
  // Additional hard rules to prevent model defaults (e.g., 'Sarah, 34').

  const displayPersonality = useMemo(() => {
    const s: any = summary as any;
    const cands = [
      s?.personality,
      s?.tone,
      s?.style,
      s?.mood,
      s?.temperament,
      s?.attitude,
      s?.disposition,
      (serverPersona as any)?.personality,
      (serverPersona as any)?.style,
      (serverPersona as any)?.tone,
    ];
    for (const v of cands) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }, [summary, serverPersona]);

  // Fetch Summary persona as single source of truth and override local state
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // LocalStorage fallback first (helps if server snapshot not yet readable)
        try {
          const raw = localStorage.getItem(`personaSummary:${id}`);
          if (raw && !summary) {
            const parsed = JSON.parse(raw);
            setSummary(parsed);
            if (process.env.NODE_ENV !== 'production') {
              // eslint-disable-next-line no-console
              console.log('[persona:summary:fallback-local]');
            }
          }
        } catch {}
        const headerLocal = (() => { try { const raw = localStorage.getItem(`personaSummary:${id}`); return raw || ''; } catch { return ''; } })();
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/persona`, { cache: 'no-store', headers: headerLocal ? { 'x-persona-local': headerLocal } as any : undefined });
        const j = res.ok ? await res.json() : null;
        if (!alive) return;
        if (j?.personaSummary) {
          setSummary(j.personaSummary);
          logCheckpoint('[persona:summary]', j.personaSummary);
        } else if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('PersonaSummary API returned empty payload');
        }
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('PersonaSummary fetch failed', e);
        }
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // Dev-only: expose and warn if key fields are missing; also log checkpoints
  const logCheckpoint = useCallback((tag: string, p: any) => {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const snap = {
        name: p?.name ?? undefined,
        age: typeof p?.age === 'number' ? p.age : (typeof p?.age === 'string' && p.age.trim() ? Number(p.age) : undefined),
        techFamiliarity: p?.techFamiliarity ?? p?.tech_level ?? p?.techLevel,
        personality: p?.personality ?? p?.tone ?? p?.style ?? p?.mood ?? p?.temperament,
      } as any;
      // eslint-disable-next-line no-console
      console.log(tag, snap);
      const w = window as any;
      w.__PERSONA_CHECKPOINTS__ = w.__PERSONA_CHECKPOINTS__ || {};
      const base = w.__PERSONA_CHECKPOINTS__.__base__ || snap;
      w.__PERSONA_CHECKPOINTS__.__base__ = base;
      const diffs: string[] = [];
      (['name','age','techFamiliarity','personality'] as const).forEach((k: any) => {
        if (String(base[k] ?? '') !== String(snap[k] ?? '')) diffs.push(k);
      });
      if (diffs.length) {
        // eslint-disable-next-line no-console
        console.warn('[persona:diff]', { at: tag, diffs, base, current: snap });
      }
      w.__PERSONA_CHECKPOINTS__[tag] = snap;
    } catch {}
  }, []);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    try { (window as any).__persona = summary ?? null; } catch {}
    if (!summary) return;
    const missing: string[] = [];
    if (!summary.personality || !summary.personality.trim()) missing.push('personality');
    if (!summary.techFamiliarity) missing.push('techFamiliarity');
    if (!Array.isArray(summary.painPoints) || summary.painPoints.length === 0) missing.push('painPoints');
    if (missing.length) console.warn('PersonaSummary missing fields:', missing.join(', '));
    try { diffPersona('prop', personaSummary as any, 'state', summary as any); } catch {}
    logCheckpoint('[persona:summary]', summary);
  }, [summary, logCheckpoint]);
  useEffect(() => {
    if (personaSummary) logCheckpoint('[persona:interview-prop]', personaSummary);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rulesAppendix = useMemo(() => {
    try {
      const name = typeof serverPersona?.name === "string" && serverPersona.name.trim() ? serverPersona.name.trim() : "";
      const age = typeof serverPersona?.age === "number" && Number.isFinite(serverPersona.age) ? serverPersona.age : undefined;
      const proj = typeof serverProject?.title === "string" && serverProject.title.trim() ? serverProject.title.trim() : "";
      const lines: string[] = [];
      if (name) lines.push("Name rule: Your name is " + name + ". Do not change it or invent other names.");
      if (age !== undefined) lines.push("Age rule: You are " + age + " years old. Do not claim a different age.");
      if (proj) lines.push("Project rule: You are participating in a research interview for \"" + proj + "\". Do not substitute a different project.");
      lines.push("Consistency rule: Do not contradict the persona details above. If asked for your name/age/role, answer consistently.");
      const rawPers = typeof serverPersona?.personality === 'string' ? serverPersona.personality.trim() : '';
      if (rawPers) lines.push("Style rule: Your disposition is '" + rawPers + "'; reflect this in tone and brevity while staying professional.");
      return lines.join("\n");
    } catch { return ""; }
  }, [serverPersona, serverProject]);
  // Compute a prompt locally from the server persona/project if the API
  // didn't return a ready-made prompt string.
    // Compute a prompt locally from the server persona/project if the API
  // didn't return a ready-made prompt string.
  const computedPrompt = useMemo(() => {
    try {
      const projectTitle = typeof serverProject?.title === 'string' && serverProject.title.trim() ? serverProject.title.trim() : 'General UX research interview.';
      const projectDesc = typeof serverProject?.description === 'string' && serverProject.description.trim() ? serverProject.description.trim() : '';
      const projectContext = [projectTitle, projectDesc].filter(Boolean).join(' - ') || 'General UX research interview.';
      if (!summary) return null;
      let { systemPrompt } = buildPrompt({ projectContext, persona: summary as any });
      const name = (summary?.name ?? '').toString().trim();
      if (name) {
        systemPrompt += `\nName rule: Your name is ${name}. Do not change it or invent other names.`;
      }
      if (summary?.extraInstructions) {
        systemPrompt += `\nAdditional instructions: ${summary.extraInstructions}`;
      }
      return systemPrompt;
    } catch {
      return null;
    }
  }, [serverProject, summary]);

  // replaced by checkpoint logs

  

  // Knobs for turn-level sensitivity scoring derived from current persona
  const scoringKnobs = useMemo(() => {
    try {
      const age = typeof serverPersona?.age === 'number' && Number.isFinite(serverPersona.age)
        ? serverPersona.age
        : (typeof summary?.age === 'number' ? summary.age : 35);
      const tech = (summary?.techFamiliarity ?? (serverPersona?.techfamiliarity ?? (serverPersona as any)?.techFamiliarity)) as any;
      const normalizePers = (v: any): "warm" | "neutral" | "reserved" => {
        const t = String(v ?? '').toLowerCase();
        if (t.includes('warm') || t.includes('friendly') || t.includes('open')) return 'warm';
        if (t.includes('reserved') || t.includes('quiet') || t.includes('guarded') || t.includes('impatient') || t.includes('angry')) return 'reserved';
        return 'neutral';
      };
      const personality = normalizePers((serverPersona as any)?.personality ?? summary?.personality);
      const traits: string[] = [];
      const add = (v: any) => { if (!v) return; if (Array.isArray(v)) v.forEach((x:any)=>{ const s=String(x).trim(); if (s) traits.push(s);}); else { const s=String(v).trim(); if (s) traits.push(s);} };
      if (serverPersona) {
        add(serverPersona.traits); add(serverPersona.goals); add(serverPersona.frustrations); add(serverPersona.painpoints);
        if (typeof (serverPersona as any).occupation === 'string' && (serverPersona as any).occupation.trim()) traits.push((serverPersona as any).occupation.trim());
      }
      return deriveInitialKnobs({ age, traits, techFamiliarity: tech, personality });
    } catch { return deriveInitialKnobs({ age: 35, traits: [], techFamiliarity: 'medium', personality: 'neutral' }); }
  }, [serverPersona, summary]);
  

  // audio + ws
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<ReturnType<typeof VoiceClient.create> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStartedRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<any | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const [micLevel, setMicLevel] = useState(0);
  const [personaLevel, setPersonaLevel] = useState(0);

  const ensureAudioContext = useCallback(async () => {
    const win = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = win.AudioContext ?? win.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtxRef.current) audioCtxRef.current = new AC();
    if (audioCtxRef.current.state === "suspended") {
      try {
        await audioCtxRef.current.resume();
      } catch {}
    }
    return audioCtxRef.current;
  }, []);

  const startMeters = useCallback(async (stream?: MediaStream) => {
    try {
      const ctx = await ensureAudioContext();
      if (!ctx) return;

      if (stream) {
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        micAnalyserRef.current = analyser;
      }

      if (audioRef.current && !remoteAnalyserRef.current) {
        const elSource = ctx.createMediaElementSource(audioRef.current);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        elSource.connect(analyser);
        elSource.connect(ctx.destination);
        remoteAnalyserRef.current = analyser;
      }

      let micBuf: Uint8Array | null = null;
      let remoteBuf: Uint8Array | null = null;
      const rms = (buf: Uint8Array | null) => {
        if (!buf || !buf.length) return 0;
        let s = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          s += v * v;
        }
        return Math.sqrt(s / buf.length);
      };

      const tick = () => {
        if (micAnalyserRef.current) {
          micBuf = micBuf ?? new Uint8Array(micAnalyserRef.current.frequencyBinCount);
          micAnalyserRef.current.getByteTimeDomainData(micBuf);
          setMicLevel(rms(micBuf));
        } else {
          setMicLevel(0);
        }
        if (remoteAnalyserRef.current) {
          remoteBuf = remoteBuf ?? new Uint8Array(remoteAnalyserRef.current.frequencyBinCount);
          remoteAnalyserRef.current.getByteTimeDomainData(remoteBuf);
          setPersonaLevel(rms(remoteBuf));
        } else {
          setPersonaLevel(0);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    } catch {}
  }, [ensureAudioContext]);

  const stopMeters = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    micAnalyserRef.current?.disconnect();
    micAnalyserRef.current = null;
    remoteAnalyserRef.current?.disconnect();
    remoteAnalyserRef.current = null;
  }, []);

  const startRecorder = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || recorderStartedRef.current) return;
    try {
      rec.start(250);
      recorderStartedRef.current = true;
    } catch (e) {
      console.warn("recorder.start", e);
    }
  }, []);

  const stopAll = useCallback(() => {
    try { recorderRef.current?.stop(); } catch {}
    recorderStartedRef.current = false;
    try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    localStreamRef.current = null;
    try { clientRef.current?.disconnect(); } catch {}
    clientRef.current = null;
    stopMeters();
    const el = audioRef.current;
    if (el) {
      try { el.pause(); } catch {}
      el.src = "";
    }
  }, [stopMeters]);

  useEffect(() => () => stopAll(), [stopAll]);
  // Also stop on unload to avoid lingering audio/credits
  // Important: do NOT call the handler in cleanup; React StrictMode mounts
  // may invoke effect cleanups on mount which would incorrectly set the
  // stop guard and block the Stop button. Only remove the listener.
  useEffect(() => {
    const h = () => {
      try { recorderRef.current?.stop(); } catch {}
      try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      try { clientRef.current?.disconnect(); } catch {}
    };
    window.addEventListener('beforeunload', h);
    return () => { window.removeEventListener('beforeunload', h); };
  }, []);
  // Removed previous duplicate beforeunload effect that set stoppingRef
  // and invoked the handler during cleanup, which could block Stop clicks.

  // Scroll chat to bottom on new turn
  useEffect(() => {
    const el = document.getElementById("chat-area");
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const coachTimersRef = useRef<Record<string, number>>({});
  const appendTurn = useCallback((t: Turn) => {
    setTurns((prev) => [...prev, t]);
    if (t.role === "user") {
      turnsSeenRef.current += 1;
      // Capture any facts stated explicitly by the user
      try {
        const facts = extractFactsFromText(t.text);
        for (const f of facts) factStoreRef.current.set(f.key, f.value);
      } catch {}
      // Real-time coach: evaluate this question after a short debounce
      if (coachEnabled) {
        const timer = window.setTimeout(() => {
          setTurns((curr) => {
            const lastAssist = [...curr].reverse().find((x) => x.role === 'persona')?.text || '';
            const evaluate = (q: string, lastA: string): { kind: string; text: string } | null => {
              const s = q.trim();
              if (!s) return null;
              const lower = s.toLowerCase();
              const greetings = ["hi","hello","hey","how are you","good morning","good afternoon"];
              if (greetings.some((g)=> lower === g || lower.startsWith(g+' '))) return { kind: 'rapport', text: 'Great rapport building.' };
              const words = s.split(/\s+/).length;
              const open = /^(how|why|what|describe|tell me|can you tell|walk me|explain)/i.test(s);
              const personal = /(income|salary|address|phone|email|ssn|social security|religion|medical|school|company)/i.test(s) && /(which|what|where|who)/i.test(s);
              if (personal) return { kind: 'too_personal', text: 'Possibly too personal; avoid specifics.' };
              if (open && words >= 5) return { kind: 'good', text: 'Good open-ended question.' };
              const shortAssist = lastA && lastA.split(/\s+/).length <= 12;
              if (shortAssist && !open) return { kind: 'probe', text: 'Probe deeper (ask for an example).' };
              if (words < 4) return { kind: 'vague', text: 'Too brief; add context.' };
              return null;
            };
            const hint = evaluate(t.text, lastAssist);
            if (!hint) return curr;
            return curr.map((x)=> x.id === t.id ? { ...x, coach: hint } : x);
          });
        }, 500);
        coachTimersRef.current[t.id] = timer as unknown as number;
      }
    }
  }, [coachEnabled]);

  // Coach: hydrate toggle from localStorage on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('coachEnabled');
      if (raw === 'true') setCoachEnabled(true);
      if (raw === 'false') setCoachEnabled(false);
    } catch {}
  }, []);

  // Coach: persist toggle to localStorage
  useEffect(() => {
    try { localStorage.setItem('coachEnabled', String(coachEnabled)); } catch {}
  }, [coachEnabled]);

  // Coach: trigger on finalized user turn (typed or VAD)
  const triggerCoach = useCallback((question: string) => {
    try {
      const q = (question || '').trim();
      if (!coachEnabled) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.log('[coach:skipped] off');
        }
        return;
      }
      if (!q) return;

      const now = Date.now();
      // clear previous hint on new question
      setCoachHint(null);
      if (now - lastCoachAtRef.current < 7000) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.log('[coach] cooldown active');
        }
        return;
      }

      const lower = q.toLowerCase();
      const greetings = ["hi","hello","hey","how are you","good morning","good afternoon"];
      const isGreeting = greetings.some((p) => lower === p || lower.startsWith(p + ' '));
      const isRapport = /\bhow are you\b|\bhow'?s your (day|week)\b|\bthanks\b|\bappreciate\b/.test(lower);
      // Allow anything except a bare one-word greeting
      if (!isRapport && isGreeting && q.split(/\s+/).length <= 2) {
        // treat as rapport, but still show a hint so users see Coach working
      }

      lastCoachAtRef.current = now;

      const lastUserTurns = turns.filter((t) => t.role === 'user').map((t) => t.text).slice(-2);
      const lastAssistTurns = turns.filter((t) => t.role === 'persona').map((t) => t.text).slice(-2);
      const sample: CoachSample & { personaSummary?: any } = {
        question: q,
        lastUserTurns,
        lastAssistTurns,
        personaKnobs: scoringKnobs as any,
        personaSummary: summary as any,
      };

      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[coach:request]', { question: q });
      }

      fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': id },
        cache: 'no-store',
        body: JSON.stringify(sample),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: CoachResponse | null) => {
          // Prefer mentor-style tip if present
          const tip = (j as any)?.tip as { label: string; message: string; suggestion?: string; severity?: 'info'|'nudge'|'important' } | undefined;
          if (tip && tip.message) {
            const composed = tip.suggestion ? `${tip.message} ${tip.suggestion}` : tip.message;
            if (process.env.NODE_ENV !== 'production') {
              // eslint-disable-next-line no-console
              console.log('[coach:tip]', tip);
            }
            setCoachSeverity(tip.severity || 'nudge');
            setCoachHint(composed);
            return;
          }
          const hint = j?.hints?.[0];
          if (hint && hint.text) {
            if (process.env.NODE_ENV !== 'production') {
              // eslint-disable-next-line no-console
              console.log('[coach:hint]', `kind=${hint.kind}`, `text="${hint.text}"`);
            }
            setCoachSeverity('nudge');
            setCoachHint(String(hint.text));
          } else {
            // Local heuristic fallback to ensure a visible hint when server gives none
            const lower = q.toLowerCase();
            const rapport = /(how are you|how's your (day|week)|thanks|appreciate)/.test(lower);
            const tooPersonal = /(income|salary|address|phone|email|medical|religion|school|company)/.test(lower) && /(which|what|where|who)/.test(lower);
            const dbl = /\bwhat\b[^?]+\band\b[^?]+\?/i.test(lower);
            const fact = /(just to confirm|did i get that right|you said|you mentioned|to clarify|let me make sure)/.test(lower);
            const rude = /(fuck|shit|dumb|stupid|idiot|bitch|bastard)/i.test(lower);
            const open = /^(how|what|why|describe|tell me|can you tell|walk me)/i.test(q);
            let text: string | null = null;
            if (rapport) text = 'Good rapport building.';
            else if (tooPersonal) text = 'That may feel uncomfortable for a persona. Reframe or avoid specifics.';
            else if (fact) text = 'Good fact-checking.';
            else if (dbl) text = 'Good to split this into two questions.';
            else if (rude) text = 'Adjust tone, this could harm the interview.';
            else if (open) text = "Nice open question. Give space and follow up gently.";
            else text = "Consider a soft probe: 'Could you share a specific example?'";
            setCoachSeverity('info');
            setCoachHint(text);
          }
        })
        .catch(() => undefined);
    } catch {}
  }, [coachEnabled, id, scoringKnobs, summary, turns]);

  const pushEmotions = useCallback((items: EmotionPair[] | undefined) => {
    if (!items || !items.length) return;
    const at = Date.now();
    setEmotionFeed((prev) => {
      const cutoff = at - 8000;
      const next = prev.filter((e) => e.at >= cutoff);
      next.push({ at, items });
      return next.slice(-50); // keep it small
    });
  }, []);

  const rollingTop3 = useMemo(() => {
    const at = Date.now();
    const cutoff = at - 8000;
    const recent = emotionFeed.filter((e) => e.at >= cutoff);
    if (!recent.length) return [] as EmotionPair[];
    const sums = new Map<string, { total: number; n: number }>();
    for (const entry of recent) {
      for (const it of entry.items) {
        const rec = sums.get(it.name) ?? { total: 0, n: 0 };
        rec.total += it.score;
        rec.n += 1;
        sums.set(it.name, rec);
      }
    }
    const avg = Array.from(sums.entries()).map(([name, v]) => ({ name, score: v.total / Math.max(1, v.n) }));
    avg.sort((a, b) => b.score - a.score);
    return avg.slice(0, 3);
  }, [emotionFeed]);

  const connectVoice = useCallback(async (token: string) => {
    setState("connecting");
    setStatusMsg("Connecting to voice...");
    setError(null);

    try {
      // Mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      localStreamRef.current = stream;
      await startMeters(stream);

      // Recorder
      const supported = getSupportedMimeType();
      const recOptions: MediaRecorderOptions | undefined = supported?.success ? { mimeType: supported.mimeType } : undefined;
      const rec = new MediaRecorder(stream, recOptions);
      recorderRef.current = rec;
      rec.addEventListener("dataavailable", async (evt: BlobEvent) => {
        if (!evt.data || evt.data.size === 0) return;
        const buf = await evt.data.arrayBuffer();
        if (clientRef.current && clientRef.current.readyState === WebSocket.OPEN) {
          try { clientRef.current.sendAudio(buf); } catch (e) { console.warn("sendAudio", e); }
        }
      });

      // WS
      const config = createSocketConfig({ auth: { type: "accessToken", value: token } });
      const client = VoiceClient.create(config);
      clientRef.current = client;

      const sampleLogged = { current: false } as { current: boolean };

      client.on("open", () => {
        setState("connected");
        setStatusMsg("Connected. Waiting for your first question.");
        setError(null);
        try { startedAtRef.current = Date.now(); } catch {}
        try {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.log('RuntimePersonaForPrompt', summary);
          }
          try { if (summary) logCheckpoint('[persona:prompt]', summary); } catch {}
          const base = ((serverPrompt ?? computedPrompt) || "");
          const finalPrompt = rulesAppendix ? base + "\n" + rulesAppendix : base;
          // Enable prosody/emotion signals if supported by the runtime.
          // The shape below is tolerant; unknown keys are ignored by the SDK.
          client.sendSessionSettings?.({
            systemPrompt: finalPrompt,
            // @ts-ignore - some SDK versions don’t type models on this call
            models: { prosody: { enable: true } },
          } as any);
        } catch {}
        startRecorder();
      });

      client.on("error", (e) => {
        console.error("voice:error", e);
        setError("Voice error");
      });

      client.on("close", () => {
        setStatusMsg("Disconnected");
        setState("idle");
        stopAll();
      });

      // Simple queue for persona audio so chunks do not cut each other off
      const audioQueue: string[] = [];
      const playNext = () => {
        const el = audioRef.current;
        if (!el) return;
        if (el.currentSrc && !el.paused && !el.ended) return; // currently playing
        const next = audioQueue.shift();
        if (!next) return;
        el.src = next;
        el.play().catch(() => undefined);
        el.onended = () => {
          try { URL.revokeObjectURL(next); } catch {}
          playNext();
        };
      };

      client.on("message", (msg: JSONMessage | AudioMessage) => {
        if ((msg as AudioMessage).type === "audio") {
          const blob = arrayBufferToBlob((msg as AudioMessage).data, "audio/webm");
          const url = URL.createObjectURL(blob);
          audioQueue.push(url);
          playNext();
          return;
        }
        const json = msg as any;
        const type = json?.type as string | undefined;

        if (type === "audio_output") {
          const b64 = json.data as string;
          const blob = base64ToBlob(b64, "audio/webm");
          const url = URL.createObjectURL(blob);
          audioQueue.push(url);
          playNext();
          return;
        }

        // Log one sample payload to the window for inspection.
        if (!window.__HUME_SAMPLE__) {
          try { window.__HUME_SAMPLE__ = json; /* eslint-disable-next-line no-console */ console.log("HUME_SAMPLE", json); } catch {}
        }

        const toText = (obj: any): string => (obj?.message?.content ?? obj?.text ?? obj?.content ?? "").toString();
        if (type === "assistant_message") {
          const content = toText(json);
          const emos = extractEmotions(json);
          pushEmotions(emos);
          if (content.trim()) appendTurn({ id: crypto.randomUUID(), role: "persona", text: content.trim(), at: new Date().toISOString(), meta: { emotions: emos } });
          return;
        }
        if (type === "user_message") {
          const content = toText(json);
          const emos = extractEmotions(json);
          // Capture emotions and show user's text
          pushEmotions(emos);
          const trimmed = content.trim();
          if (trimmed && !trimmed.startsWith('[[guidance]]')) {
            appendTurn({ id: crypto.randomUUID(), role: "user", text: trimmed, at: new Date().toISOString(), meta: { emotions: emos } });
            triggerCoach(trimmed);
          }
          return;
        }
        if (type === "conversation.message") {
          const content = toText(json);
          const roleRaw = (json?.message?.role ?? json?.role ?? json?.speaker ?? "").toString().toLowerCase();
          const role: "user" | "persona" = roleRaw.includes("assistant") || roleRaw.includes("persona") ? "persona" : "user";
          const emos = extractEmotions(json);
          pushEmotions(emos);
          const trimmed = content.trim();
          if (trimmed && !(role === 'user' && trimmed.startsWith('[[guidance]]')))
            appendTurn({ id: crypto.randomUUID(), role, text: trimmed, at: new Date().toISOString(), meta: { emotions: emos } });
          return;
        }
      });

      client.connect();
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect");
      setStatusMsg("Failed to connect");
      setState("error");
      stopAll();
    }
  }, [appendTurn, startMeters, startRecorder, stopAll, serverPrompt, computedPrompt]);

  const startInterview = useCallback(async () => {
    try {
      setState("fetching-token");
      setStatusMsg("Fetching Hume token...");
      setError(null);

      // 1) Load the latest Summary persona and set it before starting.
      try {
        const headerLocal2 = (() => { try { const raw = localStorage.getItem(`personaSummary:${id}`); return raw || ''; } catch { return ''; } })();
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/persona`, { cache: 'no-store', headers: headerLocal2 ? { 'x-persona-local': headerLocal2 } as any : undefined });
        if (res.ok) {
          const j = await res.json();
          if (j?.personaSummary) {
            setSummary(j.personaSummary);
            logCheckpoint('[persona:summary]', j.personaSummary);
          }
        }
      } catch {}

      // Prefer GET with sessionId (also capture persona/project + prompt)
      let token: string | null = null;
      const getRes = await fetch(`/api/hume/token?sessionId=${encodeURIComponent(id)}`, { method: "GET", cache: "no-store" });
      if (getRes.ok) {
        const j = await getRes.json();
        token = j.access_token ?? j.accessToken ?? null;
        setServerPrompt(typeof j.personaPrompt === "string" ? j.personaPrompt : null);
        setServerPersona(j.persona ?? null);
        setServerProject(j.project ?? null);
      }
      if (!token) {
        const postRes = await fetch("/api/hume/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: 'no-store',
          body: JSON.stringify({ sessionId: id }),
        });
        if (postRes.ok) {
          const j = await postRes.json();
          token = j.access_token ?? j.accessToken ?? null;
          setServerPrompt(typeof j.personaPrompt === "string" ? j.personaPrompt : null);
          setServerPersona(j.persona ?? null);
          setServerProject(j.project ?? null);
        } else {
          const t = await postRes.text();
          throw new Error(`Token fetch failed: ${postRes.status} ${t}`);
        }
      }
      if (!token) throw new Error("Token missing in response");

      // Session rows already exist for this page path (/sessions/[id]).
      // Avoid creating a new one here to prevent 500s if API expects project/persona ids.

      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[persona:post]', { name: summary?.name, age: summary?.age, techFamiliarity: summary?.techFamiliarity, personality: summary?.personality });
      }
      await connectVoice(token);
    } catch (e: any) {
      console.error(e);
      setState("error");
      setError(e?.message ?? "Failed to start interview");
      setStatusMsg(e?.message ?? "Failed to start interview");
    }
  }, [connectVoice, id]);

  // Acceptance (manual):
  // - Click Stop during a live session
  //   -> mic & audio stop instantly; websocket closes; optional terminate/end is attempted
  //   -> network shows one POST /api/sessions/[id]/stop (200) and navigation to /sessions/[id]/report
  //   -> no additional audio/network activity occurs afterwards
  const stopInterview = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[stop:start]', `id=${id}`);
    }
    let postedOk = false;
    try {
      // Local hard stop
      try { recorderRef.current?.stop(); } catch {}
      recorderStartedRef.current = false;
      try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      localStreamRef.current = null;
      try { await audioCtxRef.current?.close?.(); } catch {}
      stopMeters();
      const el = audioRef.current;
      if (el) { try { el.pause(); } catch {}; try { (el as any).srcObject = null; } catch {}; try { el.onended = null; } catch {}; el.src = ''; }
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[stop:media-closed]');
      }

      // End Hume session/transport
      try {
        const cl: any = clientRef.current as any;
        if (cl?.terminate) { try { await cl.terminate(); } catch {} }
        else if (cl?.end) { try { await cl.end(); } catch {} }
        else if (process.env.NODE_ENV !== 'production') { /* eslint-disable-next-line no-console */ console.log('[stop:hume-terminate-missing]'); }
      } catch {}
      try { (clientRef.current as any)?.close?.(1000, 'client-stop'); } catch {}
      try { clientRef.current?.disconnect?.(); } catch {}
      clientRef.current = null;
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[stop:hume-closed]');
      }

      // Persist transcript to in-memory store (with timeout guard)
      const mapped = turns.map((t) => ({
        speaker: t.role === 'persona' ? 'assistant' as const : 'user' as const,
        text: t.text,
        at: (() => { const n = Date.parse(t.at); return Number.isFinite(n) ? n : Date.now(); })(),
      }));
      const payload = { turns: mapped, meta: { startedAt: startedAtRef.current ?? undefined, stoppedAt: Date.now(), personaSummary: summary } };
      // Local fallback in case server/db write is delayed
      try { localStorage.setItem(`reportLocal:${id}`, JSON.stringify({ meta: { id, ...(payload.meta || {}) }, turns: mapped })); } catch {}
      pendingSaveRef.current = payload;
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => { try { controller.abort(); } catch {} }, 2500);
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(payload),
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timer);
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.log('[stop:posted]', res && 'status' in (res as any) ? (res as any).status : '', `attempt=${attempt}`);
        }
        ok = !!(res && (res as any).ok);
        if (!ok) {
          setStatusMsg("Couldn't save transcript; retrying...");
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
      if (!ok) {
        setSaveFailed(true);
        setError("Couldn't save transcript; retry below.");
      } else {
        postedOk = true;
      }
    } finally {
      setState('idle');
      setStatusMsg('Stopped.');
      setStopping(false);
      if (postedOk) {
        try { router.push(`/sessions/${id}/report`); } catch {}
      }
    }
  }, [id, router, stopMeters, summary, turns]);

  // Ensure stop on unload/unmount (idempotent)
  useEffect(() => {
    const h = () => { try { void stopInterview(); } catch {} };
    window.addEventListener('beforeunload', h);
    return () => { window.removeEventListener('beforeunload', h); };
  }, [stopInterview]);

  // Pause persona playback while user talks; resume after short silence
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const threshold = 0.2;
    let resumeTimer: number | null = null;
    if (micLevel > threshold) {
      try { if (!el.paused) el.pause(); } catch {}
      if (resumeTimer) { window.clearTimeout(resumeTimer); resumeTimer = null; }
    } else {
      resumeTimer = window.setTimeout(() => {
        try {
          if (el.paused && !el.ended) {
            const p = el.play();
            try { (p as any)?.catch?.(() => {}); } catch {}
          }
        } catch {}
      }, 500);
    }
    return () => { if (resumeTimer) window.clearTimeout(resumeTimer); };
  }, [micLevel]);

  const sendText = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !clientRef.current || clientRef.current.readyState !== WebSocket.OPEN) return;
    // Sensitivity scoring and fact guidance
    try {
      const boundaries = scoringKnobs.boundaries ?? ["income","finances","religion","medical","exact address","school name","company name"];
      const cautiousness = typeof scoringKnobs.cautiousness === 'number' ? scoringKnobs.cautiousness : 0.6;
      const openness = typeof scoringKnobs.openness === 'number' ? scoringKnobs.openness : 0.5;
      const trustWarmup = typeof scoringKnobs.trustWarmupTurns === 'number' ? scoringKnobs.trustWarmupTurns : 4;
      const sens = scoreQuestion(trimmed, { boundaries, cautiousness, openness, trustTurnsSeen: turnsSeenRef.current, trustWarmupTurns: trustWarmup });
      const { guidance } = buildFactGuidance(trimmed, factStoreRef.current);
      const stage = sens.level === 'high'
        ? `[max_sentences=${sens.maxSentences}] [if you don't know specifics, say so and ask a clarifying question] [disclose_prob=${sens.discloseProb.toFixed(2)}]`
        : `[max_sentences=${sens.maxSentences}] [disclose_prob=${sens.discloseProb.toFixed(2)}]`;
      const preface = '[[guidance]] ' + ((guidance ? guidance + ' ' : '') + stage);
      const wait = Math.max(0, sens.hesitationMs | 0);
      // Send guidance first after a short pause, then the user's text
      window.setTimeout(() => {
        try { clientRef.current?.sendUserInput(preface); } catch {}
        try { clientRef.current?.sendUserInput(trimmed); } catch {}
      }, wait);
    } catch {
      try { clientRef.current.sendUserInput(trimmed); } catch {}
    }
    appendTurn({ id: crypto.randomUUID(), role: "user", text: trimmed, at: new Date().toISOString() });
    // Live coach request (heuristic)
    triggerCoach(trimmed);
    setText("");
  }, [appendTurn, text]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Interview Session</h1>
          <p className="text-sm text-gray-500">Session ID: {id}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={"px-2 py-1 rounded border text-xs " + (coachEnabled ? "bg-amber-100 border-amber-300" : "bg-white border-gray-300")}
            aria-pressed={coachEnabled}
            onClick={() => setCoachEnabled((v) => !v)}
            title="Live coach (heuristic)"
          >
            Coach: {coachEnabled ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
            onClick={startInterview}
            disabled={state === "fetching-token" || state === "connecting" || state === "connected"}
            aria-busy={state === "fetching-token" || state === "connecting"}
          >
            {state === "connected" ? "Connected" : "Start interview"}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded bg-gray-200"
            onClick={stopInterview}
            disabled={stopping}
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      </header>

      <div aria-live="polite" className="text-sm text-gray-600">
        {error ? <span className="text-red-600">{error}</span> : statusMsg}
      </div>
      {saveFailed ? (
        <div className="text-xs text-amber-700 flex items-center gap-2">
          Save failed. Please retry.
          <button type="button" className="px-2 py-1 rounded border" onClick={retrySave}>Retry save</button>
        </div>
      ) : null}

      {/* Main layout: persona left, chat right */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        <div className="rounded border p-4">
          <h2 className="font-medium mb-2">Project & Persona</h2>
          <ul className="text-sm space-y-1">
            <li><span className="font-medium">Project:</span> {String(serverProject?.title ?? "Untitled")}</li>
            {serverProject?.description ? (
              <li className="text-gray-600">{String(serverProject.description)}</li>
            ) : null}
            <li className="mt-2 font-medium">Persona</li>
            <li>Name: {(() => { const v = String(summary?.name ?? serverPersona?.name ?? '').trim(); return v || 'Not specified'; })()}</li>
            <li>Age: {typeof summary?.age === 'number' ? summary!.age : (typeof serverPersona?.age === "number" ? serverPersona.age : 'Not specified')}</li>
            <li>Personality: {displayPersonality || 'Not specified'}</li>
            <li>Tech: {(() => {
              const raw = summary?.techFamiliarity ?? (serverPersona as any)?.techfamiliarity ?? (serverPersona as any)?.techFamiliarity;
              const t = String(raw ?? '').toLowerCase();
              if (t.includes('high')) return 'high';
              if (t.includes('medium')) return 'medium';
              if (t.includes('low')) return 'low';
              return 'Not specified';
            })()}</li>
            {(() => {
              const traits: string[] = [];
              const add = (v: any) => { if (!v) return; if (Array.isArray(v)) v.forEach(x=>{ const s=String(x).trim(); if (s) traits.push(s);}); else { const s=String(v).trim(); if (s) traits.push(s);} };
              if (summary) {
                if (summary.occupation) traits.push(summary.occupation);
              } else if (serverPersona) {
                add(serverPersona.traits);
                add(serverPersona.goals);
                add(serverPersona.frustrations);
                add(serverPersona.painpoints);
                if (typeof (serverPersona as any).occupation === 'string' && (serverPersona as any).occupation.trim()) traits.push((serverPersona as any).occupation.trim());
              }
              const text = (traits.length ? traits.slice(0, 6).join(', ') : 'none');
              return <li>Traits: {text}</li>;
            })()}
            {Array.isArray(summary?.painPoints) && summary!.painPoints.length ? (
              <li>Pain points: {summary!.painPoints.slice(0,6).join(', ')}</li>
            ) : (
              <li className="text-gray-400">Pain points: Not specified</li>
            )}
            {(summary?.extraInstructions && summary.extraInstructions.trim()) ? (
              <li className="text-gray-600">Instructions: {summary.extraInstructions.trim()}</li>
            ) : (typeof (serverPersona as any)?.notes === 'string' && (serverPersona as any).notes.trim()) ? (
              <li className="text-gray-600">Instructions: {(serverPersona as any).notes.trim()}</li>
            ) : (
              <li className="text-gray-400">Instructions: Not specified</li>
            )}
            {/* Voice config id intentionally omitted from UI to avoid defaults */}
          </ul>
        </div>

        <div className="rounded border p-0 md:col-span-2 flex flex-col">
          {coachEnabled && coachHint ? (
            <div className={"px-4 py-2 text-xs border-b " + (coachSeverity === 'important' ? 'bg-orange-100 text-orange-900' : coachSeverity === 'nudge' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-700')}>
              <span className="font-medium mr-1">Coach:</span>
              <span>{coachHint}</span>
            </div>
          ) : null}
          <div id="chat-area" className="h-[60vh] overflow-y-auto p-4 space-y-3" aria-live="polite">
            {turns.length === 0 ? (
              <div className="text-xs text-gray-500">Say or type something to begin...</div>
            ) : (
              turns.map((t) => (
                <div key={t.id} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded px-3 py-2 text-sm shadow ${t.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"}`}>
                    <div>{t.text}</div>
                    {t.meta?.emotions && t.meta.emotions.length ? (
                      <EmotionStrip items={t.meta.emotions} onDark={t.role === "user"} />
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t p-3 flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
              placeholder="Type a message..."
              className="flex-1 rounded border px-3 py-2 text-sm"
              disabled={state !== "connected"}
            />
            <button className="rounded bg-gray-200 px-3 py-2 text-sm" onClick={sendText} disabled={state !== "connected" || text.trim() === ""}>
              Send
            </button>
          </div>
        </div>
      </section>

      {/* Meters */}
      <section className="grid grid-cols-2 gap-4">
        <div className="rounded border p-4">
          <h3 className="text-sm font-medium mb-2">Mic level</h3>
          <div className="h-3 bg-gray-200 rounded">
            <div className="h-3 bg-green-500 rounded" style={{ width: `${Math.min(100, Math.round(micLevel * 100))}%` }} />
          </div>
        </div>
        <div className="rounded border p-4">
          <h3 className="text-sm font-medium mb-2">Persona level</h3>
          <div className="h-3 bg-gray-200 rounded">
            <div className="h-3 bg-indigo-500 rounded" style={{ width: `${Math.min(100, Math.round(personaLevel * 100))}%` }} />
          </div>
        </div>
      </section>

      <audio ref={audioRef} autoPlay playsInline />
    </div>
  );
}

























