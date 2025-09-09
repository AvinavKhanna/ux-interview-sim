import clsx from 'clsx';

export function ChatMessage({
  role, text, audioUrl,
}: { role: 'user' | 'persona'; text: string; audioUrl?: string }) {
  return (
    <div className={clsx('flex w-full mb-3', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div className={clsx(
        'max-w-[75%] rounded-2xl px-4 py-3 shadow',
        role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-100 rounded-bl-sm'
      )}>
        <p className="whitespace-pre-wrap">{text}</p>
        {audioUrl ? <audio className="mt-2 w-full" src={audioUrl} controls /> : null}
      </div>
    </div>
  );
}