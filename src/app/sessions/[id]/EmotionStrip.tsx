"use client";

export type EmotionPair = { name: string; score: number };

export default function EmotionStrip({ items, compact, onDark }: { items?: EmotionPair[]; compact?: boolean; onDark?: boolean }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const labelClass = onDark ? "text-[10px] text-white/90" : "text-[10px] text-gray-600";
  const scoreClass = onDark ? "text-white/75" : "text-gray-500";
  const trackClass = onDark ? "h-1.5 bg-white/25 rounded" : "h-1.5 bg-gray-200 rounded";
  const fillClass = onDark ? "h-1.5 bg-white rounded" : "h-1.5 bg-indigo-500 rounded";
  return (
    <div className={compact ? "mt-1" : "mt-2"}>
      <div className="grid grid-cols-3 gap-2">
        {list.map((e) => (
          <div key={e.name} className={labelClass}>
            <div className="flex items-center justify-between">
              <span className="truncate mr-1">{e.name}</span>
              <span className={scoreClass}>{e.score.toFixed(2)}</span>
            </div>
            <div className={trackClass}>
              <div
                className={fillClass}
                style={{ width: `${Math.max(0, Math.min(100, Math.round(e.score * 100)))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
