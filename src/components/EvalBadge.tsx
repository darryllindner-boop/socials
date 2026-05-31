import type { EvalResult, EvalSeverity } from "@/core/eval/evaluator";

const SEVERITY_STYLES: Record<EvalSeverity, string> = {
  block: "bg-red-50 text-red-700 border-red-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-slate-50 text-slate-500 border-slate-200",
};

function scoreStyle(score: number): string {
  if (score >= 0.8) return "bg-emerald-100 text-emerald-700";
  if (score >= 0.5) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

/** Compact display of the eval tool's score + issues for a variant card. */
export function EvalBadge({ result }: { result: EvalResult | null }) {
  if (!result) return null;
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreStyle(result.score)}`}
          title="Eval quality score"
        >
          Quality {Math.round(result.score * 100)}%
        </span>
        {result.blocked && (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
            Blocked
          </span>
        )}
        {!result.blocked && result.issues.length === 0 && (
          <span className="text-xs text-emerald-600">No issues</span>
        )}
      </div>
      {result.issues.length > 0 && (
        <ul className="space-y-1">
          {result.issues.map((issue, i) => (
            <li
              key={`${issue.code}-${i}`}
              className={`rounded-md border px-2 py-1 text-xs ${SEVERITY_STYLES[issue.severity]}`}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
