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

export default function StartInterviewClient({ id }: Props) {
  const [coachOn, setCoachOn] = useState(false);
  const [state, setState] = useState<ConnectState>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("Ready.");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // persona + prompt
  const persona = useMemo(
    () =>
      deriveInitialKnobs({ age: 34, traits: ["curious", "hesitant"], techFamiliarity: "medium", personality: "neutral" }),
    []
  );

  const { systemPrompt, behaviorHints } = useMemo(
    () => buildPrompt({ projectContext: "Banking app for seniors", persona }),
    [persona]
  );

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
    try {
      recorderRef.current?.stop();
    } catch {}
    recorderStartedRef.current = false;
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    localStreamRef.current = null;
    try {
      clientRef.current?.disconnect();
    } catch {}
    clientRef.current = null;
    stopMeters();
    const el = audioRef.current;
    if (el) {
      try { el.pause(); } catch {}
      el.src = "";
    }
  }, [stopMeters]);

  useEffect(() => () => stopAll(), [stopAll]);

  const connectVoice = useCallback(async (token: string) => {
    setState("connecting");
    setStatusMsg("Connecting to voice???");
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
          try {
            clientRef.current.sendAudio(buf);
          } catch (e) {
            console.warn("sendAudio", e);
          }
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
        // send prompt - do not start talking until interviewer
        try { client.sendSessionSettings?.({ systemPrompt }); } catch {}
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
        const json = msg as JSONMessage;
        const type = (json as any)?.type as string | undefined;
        if (type === "audio_output") {
          const el = audioRef.current;
          if (!el) return;
          const b64 = (json as any).data as string;
          const blob = base64ToBlob(b64, "audio/webm");
          const url = URL.createObjectURL(blob);
          el.src = url;
          el.play().catch(() => undefined);
          el.onended = () => URL.revokeObjectURL(url);
        }
      });

      client.connect();
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect");
      setStatusMsg("Failed to connect");
      setState("error");
      stopAll();
    }
  }, [startMeters, startRecorder, stopAll, systemPrompt]);

  const startInterview = useCallback(async () => {
    try {
      setState("fetching-token");
      setStatusMsg("Fetching Hume token???");
      setError(null);

      // Prefer GET with sessionId
      let token: string | null = null;
      const getRes = await fetch(`/api/hume/token?sessionId=${encodeURIComponent(id)}`, { method: "GET", cache: "no-store" });
      if (getRes.ok) {
        const j = await getRes.json();
        token = j.access_token ?? j.accessToken ?? null;
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
        } else {
          const t = await postRes.text();
          throw new Error(`Token fetch failed: ${postRes.status} ${t}`);
        }
      }
      if (!token) throw new Error("Token missing in response");
      setAccessToken(token);

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
      resumeTimer = window.setTimeout(() => {
        try { if (el.paused && !el.ended) void el.play(); } catch {}
      }, 400);
    }
    return () => { if (resumeTimer) window.clearTimeout(resumeTimer); };
  }, [micLevel]);

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
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={coachOn} onChange={(e) => setCoachOn(e.target.checked)} aria-pressed={coachOn} />
            Coach
          </label>
        </div>
      </header>

      <div aria-live="polite" className="text-sm text-gray-600">
        {error ? <span className="text-red-600">{error}</span> : statusMsg}
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded border p-4">
          <h2 className="font-medium mb-2">Persona</h2>
          <ul className="text-sm space-y-1">
            <li>Age: {persona.age}</li>
            <li>Personality: {persona.personality}</li>
            <li>Tech: {persona.techFamiliarity}</li>
            <li>Traits: {persona.traits.join(", ") || "none"}</li>
            <li>Voice cfg: {persona.voiceConfigId}</li>
          </ul>
        </div>
        <div className="rounded border p-4 md:col-span-2">
          <h2 className="font-medium mb-2">System Prompt</h2>
          <pre className="text-xs whitespace-pre-wrap">{systemPrompt}</pre>
          <h3 className="font-medium mt-3 mb-1 text-sm">Behavior hints</h3>
          <ul className="list-disc list-inside text-xs">
            {behaviorHints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      </section>

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

