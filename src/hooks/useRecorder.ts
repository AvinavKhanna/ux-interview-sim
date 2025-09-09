import { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'recording' | 'processing' | 'error';

export function useRecorder() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  async function start() {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = 'audio/webm;codecs=opus';
    const fallback = 'audio/mp4';
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : fallback;

    const mr = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    mr.onerror = (e) => setError((e as any).error?.message || 'Recorder error');
    mr.onstop = () => stream.getTracks().forEach(t => t.stop());

    mediaRef.current = mr;
    mr.start(); // push-to-talk style; keep it simple first
    setStatus('recording');
  }

  async function stop(): Promise<Blob | null> {
    const mr = mediaRef.current;
    if (!mr) return null;
    setStatus('processing');
    const blobPromise = new Promise<Blob>((resolve) => {
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        resolve(blob);
      };
    });
    mr.stop();
    const blob = await blobPromise;
    setStatus('idle');
    return blob;
  }

  return { start, stop, status, error };
}