'use client';
import React from 'react';

export function ChatMessage({
  role,
  text,
  audioUrl,
}: { role: 'user' | 'persona'; text?: string; audioUrl?: string }) {
  const isUser = role === 'user';
  const bubble =
    isUser
      ? 'bg-blue-600 text-white'
      : 'bg-gray-100 text-gray-900';

  return (
    <div className={`w-full flex ${isUser ? 'justify-end' : 'justify-start'} my-2`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 shadow ${bubble}`}>
        {text && text.trim() ? (
          <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
        ) : (
          <p className="italic text-gray-500">{isUser ? '(no transcript)' : '(no reply)'}</p>
        )}
        {audioUrl ? (
          <audio className="mt-2 w-full" src={audioUrl} controls preload="metadata" />
        ) : null}
      </div>
    </div>
  );
}
