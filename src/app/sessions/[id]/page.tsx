"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Button, Page, Card } from "@/components/UI";
import { supabaseBrowser } from "@/lib/supabase";

type Turn = { role: "user" | "assistant"; content: string };

/** ===== Tunables ===== */
const LEVEL_THRESHOLD = 0.02;     // was 0.03 → more sensitive
const SILENCE_FRAMES = 6;         // was 10 → ~180ms pause ends a segment
const WARMUP_MS = 700;            // was 900 → start VAD sooner
const MIN_SEGMENT_BYTES = 12_000; // keep
const MAX_SEGMENT_MS = 7000;      // NEW: hard-cut any utterance at 7s

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = React.useMemo(() => {
    const p = params?.id as unknown;
    return Array.isArray(p) ? p[0] : (p as string);
  }, [params]);

  /** UI state */
  const [continuous, setContinuous] = React.useState(true);
  const [recording, setRecording] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [transcript, setTranscript] = React.useState<Turn[]>([]);
  const [lastUserText, setLastUserText] = React.useState("");
  const [lastError, setLastError] = React.useState("");

  /** Media / meter */
  const streamRef = React.useRef<MediaStream | null>(null);
  const [level, setLevel] = React.useState(0);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = React.useRef<number | null>(null);

  /** VAD state */
  const startTsRef = React.useRef<number>(0);
  const speakingRef = React.useRef(false);
  const silenceCountRef = React.useRef(0);

  /** Segment recorder (continuous mode) */
  const segRecorderRef = React.useRef<MediaRecorder | null>(null);
  const segChunksRef = React.useRef<Blob[]>([]);
  const uploadBusyRef = React.useRef(false);

  /** Single-shot recorder */
  const singleRecorderRef = React.useRef<MediaRecorder | null>(null);
  const singleChunksRef = React.useRef<Blob[]>([]);

  const segStartTsRef = React.useRef<number>(0); // NEW

  // ---------- meter ----------
  function startMeter(stream: MediaStream) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.85;

      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = src;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const a = analyserRef.current;
        if (!a) return;

        a.getByteTimeDomainData(buf);
        let sum = 0, peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
          const av = Math.abs(v);
          if (av > peak) peak = av;
        }
        const rms = Math.sqrt(sum / buf.length);
        const lvl = Math.min(1, Math.max(peak * 3.0, rms * 6.0));
        setLevel(lvl);

        // VAD loop
        if (continuous && streamRef.current) {
          const sinceStart = performance.now() - startTsRef.current;
          const vadEnabled = sinceStart > WARMUP_MS;

          if (vadEnabled && lvl > LEVEL_THRESHOLD) {
            // speaking
            silenceCountRef.current = 0;
            if (!speakingRef.current) {
              speakingRef.current = true;
              startSegmentRecorder(streamRef.current!);
            }
          } else {
            // silence
            if (speakingRef.current) {
              silenceCountRef.current++;
              if (silenceCountRef.current >= SILENCE_FRAMES) {
                speakingRef.current = false;
                stopSegmentRecorder(); // finalize and upload
              }
            }
          }
        
          // NEW: hard-cut long segments
          if (speakingRef.current && segRecorderRef.current) {
            const segAge = performance.now() - segStartTsRef.current;
            if (segAge >= MAX_SEGMENT_MS) {
              speakingRef.current = false;
              stopSegmentRecorder();
              silenceCountRef.current = 0;
            }
          }


        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // meter optional
    }
  }

  function stopMeter() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      sourceRef.current?.disconnect();
      audioCtxRef.current?.close();
    } catch {}
    analyserRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    setLevel(0);
  }

  // ---------- segment recorder (continuous) ----------
  function startSegmentRecorder(stream: MediaStream) {
    // already running?
    if (segRecorderRef.current) return;

    const mime =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const mr = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      audioBitsPerSecond: 128_000,
    });
    segChunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) segChunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      const blob = new Blob(segChunksRef.current, { type: "audio/webm" });
      segChunksRef.current = [];
      await transcribeAndAppend(blob);
    };
    segRecorderRef.current = mr;
    mr.start(); // no timeslice: one complete webm per utterance
    segStartTsRef.current = performance.now(); // NEW
  }

  function stopSegmentRecorder() {
    const mr = segRecorderRef.current;
    if (!mr) return;
    try { mr.requestData(); } catch {}
    mr.stop();
    segRecorderRef.current = null;
  }

  // ---------- single-shot recorder ----------
  async function startSingleShot() {
    setLastError("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mime =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const mr = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      audioBitsPerSecond: 128_000,
    });
    singleChunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) singleChunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      const blob = new Blob(singleChunksRef.current, { type: "audio/webm" });
      await transcribeAndAppend(blob);
      teardownStream();
    };
    singleRecorderRef.current = mr;

    startTsRef.current = performance.now();
    startMeter(stream);
    mr.start(); // full single blob
    setRecording(true);
  }

  async function stopSingleShot() {
    const mr = singleRecorderRef.current;
    if (!mr) return;
    setBusy(true);
    try { mr.requestData(); } catch {}
    mr.stop();
  }

  // ---------- shared mic control ----------
  async function startRecording() {
    setLastError("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    startTsRef.current = performance.now();
    startMeter(stream);
    setRecording(true);

    if (!continuous) {
      // fall back to single-shot flow if toggle off
      await startSingleShot();
    }
  }

  async function stopContinuous() {
    setBusy(true);
    try {
      if (segRecorderRef.current) {
        stopSegmentRecorder(); // final utterance
        // give it a moment to fire onstop
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      setBusy(false);
      teardownStream();
    }
  }

  function teardownStream() {
    stopMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    speakingRef.current = false;
    silenceCountRef.current = 0;
    setRecording(false);
  }

  // ---------- whisper ----------
  async function transcribeAndAppend(blob: Blob) {
    if (uploadBusyRef.current) return;
    if (blob.size < MIN_SEGMENT_BYTES) return;

    uploadBusyRef.current = true;
    setLastError("");

    try {
      const fd = new FormData();
      fd.append("audio", blob, "segment.webm"); // filename is IMPORTANT

      const res = await fetch("/api/interview", { method: "POST", body: fd });
      if (res.status === 204) return; // tiny/no-content, ignore

      const clone = res.clone();
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        const txt = await clone.text();
        console.warn(`/api/interview ${res.status}: ${txt.slice(0, 200)}`);
        return;
      }

      if (!res.ok) {
        console.warn(data?.error || `Transcription failed (${res.status})`);
        return;
      }

      const text = (data?.text ?? "").trim();
      if (!text) return;

      setLastUserText(text);
      setTranscript((prev) => [...prev, { role: "user", content: text }]);

      if (sessionId) {
        await supabaseBrowser.from("turns").insert([{ sessionId, role: "user", content: text }]);
      }
    } finally {
      uploadBusyRef.current = false;
    }
  }

  // ---------- UI ----------
  const pct = Math.round(level * 100);

  return (
    <Page title="Interview Session">
      <Card className="p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            {!recording ? (
              <Button onClick={startRecording} disabled={busy}>
                {continuous ? "Start (Hands-free)" : "Record"}
              </Button>
            ) : continuous ? (
              <Button variant="ghost" onClick={stopContinuous} disabled={busy}>
                Stop (Hands-free)
              </Button>
            ) : (
              <Button variant="ghost" onClick={stopSingleShot} disabled={busy}>
                Stop & Transcribe
              </Button>
            )}

            {recording && (
              <Button
                variant="ghost"
                onClick={continuous ? stopContinuous : stopSingleShot}
                disabled={busy}
              >
                End interview
              </Button>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={continuous}
                onChange={(e) => setContinuous(e.target.checked)}
                disabled={recording}
              />
              Continuous mode
            </label>
          </div>

          {/* Mic meter */}
          <div className="flex items-center gap-3">
            <div className="w-64 h-2 bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs text-gray-600 w-12">{pct}%</div>
          </div>

          <div className="text-xs text-gray-500">
            <span className="font-medium">Last user text:</span> {lastUserText || "—"}
          </div>

          {lastError && (
            <div className="text-xs text-red-600">
              <span className="font-semibold">Note:</span> {lastError}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6 mt-6">
        <h3 className="text-lg font-medium mb-3">Transcript</h3>
        {transcript.length === 0 ? (
          <p className="text-sm text-gray-500">No turns yet.</p>
        ) : (
          <div className="space-y-2">
            {transcript.map((t, i) => (
              <div key={i} className="text-sm">
                <span className={t.role === "user" ? "font-semibold" : "text-indigo-700 font-semibold"}>
                  {t.role === "user" ? "You" : "Persona"}
                </span>
                {": "} {t.content}
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}