'use client';

import React, { use, useEffect, useState } from 'react';
import { useRecorder } from '@/hooks/useRecorder';
import { ChatMessage } from '@/components/ChatMessage';

type Msg = { role: 'user' | 'persona'; text: string; audioUrl?: string };

export default function InterviewPage(props: { params: Promise<{ id: string }> }) {
  // ✅ Unwrap Next.js 15 params Promise
  const { id } = use(props.params);

  const { start, stop, status, error } = useRecorder();
  const [messages, setMessages] = useState<Msg[]>([]);

  async function handleRecord() {
    await start();
  }

  async function handleStop() {
    const blob = await stop();
    if (!blob) return;

    // normalize blob → File for Whisper (use webm)
    const file = new File([blob], 'q.webm', { type: 'audio/webm' });

    const fd = new FormData();
    fd.append('audio', file);
    fd.append('sessionId', id); // <-- now defined

    const res = await fetch('/api/interview', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Interview failed');
      return;
    }

    // Build next messages explicitly to keep Msg typing happy
    const next: Msg[] = [];
    next.push({ role: 'user', text: data.transcript });
    if (data.replyText && typeof data.replyText === 'string' && data.replyText.trim().length) {
      next.push({
        role: 'persona',
        text: data.replyText,
        audioUrl: data.ttsUrl ?? undefined,
      });
    }

    setMessages((prev) => [...prev, ...next]);
  }

  useEffect(() => {
    if (error) alert(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold mb-4">Interview</h1>

      <div className="border rounded-xl p-4 h-[65vh] overflow-y-auto bg-white">
        {messages.length === 0 && (
          <div className="text-gray-500">
            Press “Hold to Talk”, ask your question, then release.
          </div>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} role={m.role} text={m.text} audioUrl={m.audioUrl} />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          className={`px-4 py-2 rounded-full text-white ${
            status === 'recording' ? 'bg-red-600' : 'bg-blue-600'
          }`}
          onMouseDown={handleRecord}
          onMouseUp={handleStop}
          onTouchStart={handleRecord}
          onTouchEnd={handleStop}
        >
          {status === 'recording' ? 'Recording… release to send' : 'Hold to Talk'}
        </button>
        <span className="text-sm text-gray-500">
          {status === 'recording' ? 'Listening…' : 'Idle'}
        </span>
      </div>
    </div>
  );
}
