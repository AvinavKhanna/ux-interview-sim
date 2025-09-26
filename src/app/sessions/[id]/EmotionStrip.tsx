"use client";

export type EmotionPair = { name: string; score: number };

export default function EmotionStrip({ items, compact }: { items?: EmotionPair[]; compact?: boolean }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <div className={compact ? "mt-1" : "mt-2"}>
      <div className="grid grid-cols-3 gap-2">
        {list.map((e) => (
          <div key={e.name} className="text-[10px] text-gray-600">
            <div className="flex items-center justify-between">
              <span className="truncate mr-1">{e.name}</span>
              <span>{e.score.toFixed(2)}</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded">
              <div
                className="h-1.5 bg-indigo-500 rounded"
                style={{ width: `${Math.max(0, Math.min(100, Math.round(e.score * 100)))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

