"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPrompt, deriveInitialKnobs } from "@/lib/prompt/personaPrompt";
import {
  VoiceClient,
  createSocketConfig,
  base64ToBlob,
  arrayBufferToBlob,
  getSupportedMimeType,
  type AudioMessage,
  type JSONMessage,
} from "@humeai/voice";

type Props = { id: string };

type ConnectState = "idle" | "fetching-token" | "connecting" | "connected" | "error";

type Turn = {
  id: string;
  role: "user" | "persona";
  text: string;
  at: string;
};

export default function StartInterviewClient({ id }: Props) {
  const [state, setState] = useState<ConnectState>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("Ready.");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  // Resolved from the token route (real selected persona/project)
  const [serverPrompt, setServerPrompt] = useState<string | null>(null);
  const [serverPersona, setServerPersona] = useState<any | null>(null);
  const [serverProject, setServerProject] = useState<any | null>(null);
  // Fallback persona + prompt (used until server returns real data)
  const fallbackPersona = useMemo(
    () => deriveInitialKnobs({ age: 34, traits: ["curious", "hesitant"], techFamiliarity: "medium", personality: "neutral" }),
    []
  );
  const fallbackPrompt = useMemo(
    () => buildPrompt({ projectContext: "General UX research interview.", persona: fallbackPersona }).systemPrompt,
    [fallbackPersona]
  );
  // Compute a prompt locally from the server persona/project if the API
  // didn't return a ready-made prompt string.
    // Compute a prompt locally from the server persona/project if the API
  // didn't return a ready-made prompt string.
  const computedPrompt = useMemo(() => {
    try {
      const projectTitle = typeof serverProject?.title === "string" && serverProject.title.trim() ? serverProject.title.trim() : "General UX research interview.";
      const projectDesc = typeof serverProject?.description === "string" && serverProject.description.trim() ? serverProject.description.trim() : "";
      const projectContext = [projectTitle, projectDesc].filter(Boolean).join(' - ') || 'General UX research interview.';

      const age = typeof serverPersona?.age === 'number' && Number.isFinite(serverPersona.age) ? serverPersona.age : fallbackPersona.age;
      const tech = (serverPersona?.techfamiliarity ?? (serverPersona as any)?.techFamiliarity ?? fallbackPersona.techFamiliarity) as any;
      const personality = (serverPersona?.personality ?? fallbackPersona.personality) as any;
      const traits: string[] = [];
      if (serverPersona) {
        const add = (v: any) => {
          if (!v) return;
          if (Array.isArray(v)) v.forEach((x) => { const s = String(x).trim(); if (s) traits.push(s); });
          else { const s = String(v).trim(); if (s) traits.push(s); }
        };
        add(serverPersona.painpoints);
        add(serverPersona.goals);
        add(serverPersona.frustrations);
        if (typeof (serverPersona as any).occupation === 'string' && (serverPersona as any).occupation.trim()) traits.push((serverPersona as any).occupation.trim());
      }
      const knobs = deriveInitialKnobs({ age, traits, techFamiliarity: tech, personality });
      let { systemPrompt } = buildPrompt({ projectContext, persona: knobs });
      const name = typeof serverPersona?.name === 'string' && serverPersona.name.trim() ? serverPersona.name.trim() : '';
      if (name) {
        systemPrompt += `\nName rule: Your name is ${name}. Do not change it or invent other names.`;
      }
      return systemPrompt;
    } catch {
      return null;
    }
  }, [serverPersona, serverProject, fallbackPersona]);
  

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

  // Scroll chat to bottom on new turn
  useEffect(() => {
    const el = document.getElementById("chat-area");
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const appendTurn = useCallback((t: Turn) => {
    setTurns((prev) => [...prev, t]);
  }, []);

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

      client.on("open", () => {
        setState("connected");
        setStatusMsg("Connected. Waiting for your first question.");
        setError(null);
        try { client.sendSessionSettings?.({ systemPrompt: serverPrompt ?? computedPrompt ?? fallbackPrompt }); } catch {}
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

      client.on("message", (msg: JSONMessage | AudioMessage) => {
        if ((msg as AudioMessage).type === "audio") {
          const el = audioRef.current;
          if (!el) return;
          const blob = arrayBufferToBlob((msg as AudioMessage).data, "audio/webm");
          const url = URL.createObjectURL(blob);
          el.src = url;
          el.play().catch(() => undefined);
          el.onended = () => URL.revokeObjectURL(url);
          return;
        }
        const json = msg as any;
        const type = json?.type as string | undefined;

        if (type === "audio_output") {
          const el = audioRef.current;
          if (!el) return;
          const b64 = json.data as string;
          const blob = base64ToBlob(b64, "audio/webm");
          const url = URL.createObjectURL(blob);
          el.src = url;
          el.play().catch(() => undefined);
          el.onended = () => URL.revokeObjectURL(url);
          return;
        }

        const toText = (obj: any): string => (obj?.message?.content ?? obj?.text ?? obj?.content ?? "").toString();
        if (type === "assistant_message") {
          const content = toText(json);
          if (content.trim()) appendTurn({ id: crypto.randomUUID(), role: "persona", text: content.trim(), at: new Date().toISOString() });
          return;
        }
        if (type === "user_message") {
          const content = toText(json);
          if (content.trim()) appendTurn({ id: crypto.randomUUID(), role: "user", text: content.trim(), at: new Date().toISOString() });
          return;
        }
        if (type === "conversation.message") {
          const content = toText(json);
          const roleRaw = (json?.message?.role ?? json?.role ?? json?.speaker ?? "").toString().toLowerCase();
          const role: "user" | "persona" = roleRaw.includes("assistant") || roleRaw.includes("persona") ? "persona" : "user";
          if (content.trim()) appendTurn({ id: crypto.randomUUID(), role, text: content.trim(), at: new Date().toISOString() });
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
  }, [appendTurn, startMeters, startRecorder, stopAll, serverPrompt, fallbackPrompt]);

  const startInterview = useCallback(async () => {
    try {
      setState("fetching-token");
      setStatusMsg("Fetching Hume token...");
      setError(null);

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

      // Ensure there is a session row (non-blocking if it already exists)
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: { name: "Participant", age: 35, personality: "neutral", techFamiliarity: "medium" } }),
      }).catch(() => undefined);

      await connectVoice(token);
    } catch (e: any) {
      console.error(e);
      setState("error");
      setError(e?.message ?? "Failed to start interview");
      setStatusMsg(e?.message ?? "Failed to start interview");
    }
  }, [connectVoice, id]);

  const stopInterview = useCallback(() => {
    stopAll();
    setState("idle");
    setStatusMsg("Stopped.");
  }, [stopAll]);

  // Pause persona playback while user talks; resume after short silence
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const threshold = 0.18;
    let resumeTimer: number | null = null;
    if (micLevel > threshold) {
      try { if (!el.paused) el.pause(); } catch {}
      if (resumeTimer) { window.clearTimeout(resumeTimer); resumeTimer = null; }
    } else {
      resumeTimer = window.setTimeout(() => { try { if (el.paused && !el.ended) void el.play(); } catch {} }, 400);
    }
    return () => { if (resumeTimer) window.clearTimeout(resumeTimer); };
  }, [micLevel]);

  const sendText = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !clientRef.current || clientRef.current.readyState !== WebSocket.OPEN) return;
    try { clientRef.current.sendUserInput(trimmed); } catch {}
    appendTurn({ id: crypto.randomUUID(), role: "user", text: trimmed, at: new Date().toISOString() });
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
            disabled={state !== "connected"}
          >
            Stop
          </button>
        </div>
      </header>

      <div aria-live="polite" className="text-sm text-gray-600">
        {error ? <span className="text-red-600">{error}</span> : statusMsg}
      </div>

      {/* Main layout: persona left, chat right */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded border p-4">
          <h2 className="font-medium mb-2">Project & Persona</h2>
          <ul className="text-sm space-y-1">
            <li><span className="font-medium">Project:</span> {String(serverProject?.title ?? "Untitled")}</li>
            {serverProject?.description ? (
              <li className="text-gray-600">{String(serverProject.description)}</li>
            ) : null}
            <li className="mt-2 font-medium">Persona</li>
            {serverPersona?.name ? (<li>Name: {String(serverPersona.name)}</li>) : null}
            <li>Age: {typeof serverPersona?.age === "number" ? serverPersona.age : fallbackPersona.age}</li>
            <li>Personality: {String(serverPersona?.personality ?? fallbackPersona.personality)}</li>
            <li>Tech: {String(serverPersona?.techfamiliarity ?? fallbackPersona.techFamiliarity)}</li>
            <li>Traits: {Array.isArray(serverPersona?.painpoints) ? (serverPersona.painpoints as any[]).slice(0, 2).join(", ") : (fallbackPersona.traits.join(", ") || "none")}</li>
            <li>Voice cfg: {fallbackPersona.voiceConfigId}</li>
          </ul>
        </div>

        <div className="rounded border p-0 md:col-span-2 flex flex-col">
          <div id="chat-area" className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
            {turns.length === 0 ? (
              <div className="text-xs text-gray-500">Say or type something to begin...</div>
            ) : (
              turns.map((t) => (
                <div key={t.id} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded px-3 py-2 text-sm shadow ${t.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"}`}>
                    {t.text}
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

