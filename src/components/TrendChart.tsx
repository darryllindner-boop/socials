import type { TrendPoint } from "@/core/analytics/aggregate";

/**
 * Minimal CSS bar chart for daily engagement (no charting dependency). Bars are
 * scaled to the busiest day; hover shows the exact value + post count.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.engagement));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex h-40 items-end gap-1">
        {points.map((p) => {
          const heightPct = Math.round((p.engagement / max) * 100);
          return (
            <div
              key={p.date}
              className="group flex flex-1 flex-col items-center justify-end"
              title={`${p.date}: ${p.engagement} engagement · ${p.posts} post(s)`}
            >
              <div
                className="w-full rounded-t bg-brand-500/80 transition-all group-hover:bg-brand-600"
                style={{ height: `${Math.max(heightPct, p.engagement > 0 ? 4 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        <span>{points[0]?.date.slice(5)}</span>
        <span>engagement / day</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}
