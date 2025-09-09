export function RecorderButton({
  recording, onStart, onStop, disabled,
}: { recording: boolean; onStart: () => void; onStop: () => void; disabled?: boolean }) {
  return (
    <button
      className={`px-4 py-2 rounded-full text-white ${recording ? 'bg-red-600' : 'bg-blue-600'}`}
      onClick={recording ? onStop : onStart}
      disabled={!!disabled}
    >
      {recording ? 'Stop' : 'Hold to Talk'}
    </button>
  );
}