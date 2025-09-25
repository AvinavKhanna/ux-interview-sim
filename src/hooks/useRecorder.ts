'use client';

import { useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'recording' | 'error';

type UseRecorder = {
  start: () => Promise<void>;
  stop: () => Promise<File | null>;
  status: RecorderStatus;
  error: string | null;
};

function canonicalMime(mime: string): { mime: string; ext: string } {
  const t = (mime || '').toLowerCase();
  if (t.includes('webm')) return { mime: 'audio/webm', ext: 'webm' };
  if (t.includes('ogg'))  return { mime: 'audio/ogg',  ext: 'ogg'  };
  if (t.includes('wav'))  return { mime: 'audio/wav',  ext: 'wav'  };
  if (t.includes('mp4'))  return { mime: 'audio/mp4',  ext: 'mp4'  };
  if (t.includes('mpeg') || t.includes('mp3') || t.includes('mpga'))
    return { mime: 'audio/mpeg', ext: 'mp3' };
  return { mime: 'audio/webm', ext: 'webm' };
}

export function useRecorder(): UseRecorder {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  async function start() {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick a supported MIME that actually works on most setups.
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const chosen =
        candidates.find(t => (window as any).MediaRecorder?.isTypeSupported?.(t)) || undefined;

      const mr = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onerror = (e: any) => {
        console.error('MediaRecorder error:', e);
        setError(e?.message || 'Recorder error');
        setStatus('error');
      };
      mr.onstop = () => {
        // always stop mic
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      mediaRef.current = mr;
      startedAtRef.current = Date.now();
      mr.start(250); // emit chunks every 250ms
      setStatus('recording');
    } catch (e: any) {
      setError(e?.message || 'Microphone permission error');
      setStatus('error');
    }
  }

  async function stop(): Promise<File | null> {
    const mr = mediaRef.current;
    if (!mr) return null;

    // ensure enough time for at least one chunk; reduce minimum to lower latency
    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));

    try { if (mr.state === 'recording') mr.requestData(); } catch {}

    const blob: Blob = await new Promise((resolve) => {
      mr.addEventListener(
        'stop',
        () => resolve(new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })),
        { once: true }
      );
      mr.stop();
    });

    setStatus('idle');

    if (!blob || !blob.size) {
      setError('No audio captured');
      return null;
    }

    // Strip codec suffix, force canonical MIME + extension
    const { mime, ext } = canonicalMime(blob.type);
    return new File([blob], `q.${ext}`, { type: mime });
  }

  return { start, stop, status, error };
}
