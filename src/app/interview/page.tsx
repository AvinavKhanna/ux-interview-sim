'use client';
import { Page } from '@/components/UI';

export default function InterviewPlaceholder() {
  return (
    <Page title="Interview Room (Prototype)">
      <p className="text-sm text-gray-700">
        Placeholder. Phase 2 will wire mic → STT → LLM → TTS, live transcript, coaching cues, and save the session.
      </p>
    </Page>
  );
}