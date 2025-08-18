"use client";

import { useEffect, useRef, useState } from "react";

type RecorderState = "idle" | "recording" | "stopped";

export function useRecorder() {
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (mediaRef.current && mediaRef.current.state !== "inactive") {
        mediaRef.current.stop();
      }
    };
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();
      mediaRef.current = rec;
      setState("recording");
    } catch (e: any) {
      setError(e?.message ?? "Microphone permission denied");
      setState("idle");
    }
  }

  async function stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = mediaRef.current;
      if (!rec || rec.state === "inactive") {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        // stop mic tracks
        rec.stream.getTracks().forEach((t) => t.stop());
        mediaRef.current = null;
        setState("stopped");
        resolve(blob);
      };
      rec.stop();
    });
  }

  function reset() {
    chunksRef.current = [];
    setState("idle");
    setError(null);
  }

  return { state, error, start, stop, reset };
}