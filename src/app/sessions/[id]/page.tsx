'use client';

import { useEffect, useState } from 'react';
import { useRecorder } from '@/hooks/useRecorder';
import { ChatMessage } from '@/components/ChatMessage';

export default function InterviewPage({ params }: { params: { sessionId: string } }) {
  const { start, stop, status, error } = useRecorder();
  const [messages, setMessages] = useState<Array<{ role:'user'|'persona'; text:string; audioUrl?:string }>>([]);

  async function handleRecord() {
    await start();
  }
  async function handleStop() {
    const blob = await stop();
    if (!blob) return;

    const fd = new FormData();
    fd.append('audio', blob, `q.${blob.type.includes('webm') ? 'webm' : 'mp4'}`);
    fd.append('sessionId', params.sessionId);

    const res = await fetch('/api/interview', { method: 'POST', body: fd });
    if (res.status === 204) return; // silence, do nothing
    const data = await res.json(); // { transcript, replyText, ttsUrl }
    if (!res.ok) {
      alert(data.error || 'Interview failed');
      return;
    }

    setMessages((m) => [
      ...m,
      { role: 'user', text: data.transcript },
      { role: 'persona', text: data.replyText, audioUrl: data.ttsUrl },
    ]);
  }

  // allow hitting Enter to play/pause? optional
  useEffect(() => { if (error) alert(error); }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold mb-4">Interview</h1>
      <div className="border rounded-xl p-4 h-[65vh] overflow-y-auto bg-white">
        {messages.length === 0 && (
          <div className="text-gray-500">Press “Hold to Talk”, ask your question, then release.</div>
        )}
        {messages.map((m, i) => <ChatMessage key={i} role={m.role} text={m.text} audioUrl={m.audioUrl} />)}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          className={`px-4 py-2 rounded-full text-white ${status==='recording' ? 'bg-red-600' : 'bg-blue-600'}`}
          onMouseDown={handleRecord}
          onMouseUp={handleStop}
          onTouchStart={handleRecord}
          onTouchEnd={handleStop}
        >
          {status==='recording' ? 'Recording… release to send' : 'Hold to Talk'}
        </button>
        <span className="text-sm text-gray-500">
          {status==='recording' ? 'Listening…' : 'Idle'}
        </span>
      </div>
    </div>
  );
}