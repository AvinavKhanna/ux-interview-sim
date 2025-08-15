'use client';

export default function SessionPage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold mb-2">Interview session</h1>
      <p className="text-sm text-gray-600">Session ID: {params.id}</p>
      <div className="mt-4">
        {/* Phase 4: microphone, transcript, real-time feedback, etc. */}
        <p>Session created. Voice/text loop coming in Phase 4.</p>
      </div>
    </div>
  );
}