import { PlatformBadge } from "@/components/PlatformBadge";
import { TrendChart } from "@/components/TrendChart";
import { PLATFORM_LABELS } from "@/core/types";
import { getAnalytics } from "@/server/analytics";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

export default async function AnalyticsPage() {
  let data: Awaited<ReturnType<typeof getAnalytics>> | null = null;
  let dbError: string | null = null;
  try {
    data = await getAnalytics();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Engagement across everything you&apos;ve published. Metrics are pulled automatically
          after publishing (and on demand from the review queue).
        </p>
      </div>

      {dbError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Database not reachable yet. Run <code>npm run db:migrate</code> and{" "}
          <code>npm run db:seed</code>. ({dbError})
        </div>
      )}

      {data && data.summary.totalPosts === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          Nothing published yet. Once posts go out, their engagement shows up here.
        </div>
      )}

      {data && data.summary.totalPosts > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Published" value={data.summary.totalPosts} />
            <StatCard label="Likes" value={data.summary.totals.likes.toLocaleString()} />
            <StatCard label="Comments" value={data.summary.totals.comments.toLocaleString()} />
            <StatCard label="Shares" value={data.summary.totals.shares.toLocaleString()} />
            <StatCard label="Impressions" value={data.summary.totals.impressions.toLocaleString()} />
            <StatCard label="Reach" value={data.summary.totals.reach.toLocaleString()} />
            <StatCard label="Engagement" value={data.summary.totals.engagement.toLocaleString()} />
            <StatCard
              label="Avg quality"
              value={data.summary.avgEvalScore !== null ? `${Math.round(data.summary.avgEvalScore * 100)}%` : "—"}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-800">
              Engagement · last {data.trendDays} days{" "}
              <span className="text-xs font-normal text-slate-400">({data.timezone})</span>
            </h2>
            <TrendChart points={data.trend} />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-800">By platform</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Platform</th>
                    <th className="px-4 py-2">Posts</th>
                    <th className="px-4 py-2">Likes</th>
                    <th className="px-4 py-2">Comments</th>
                    <th className="px-4 py-2">Shares</th>
                    <th className="px-4 py-2">Avg engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary.byPlatform.map((p) => (
                    <tr key={p.platform} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <PlatformBadge platform={p.platform} />
                      </td>
                      <td className="px-4 py-2">{p.posts}</td>
                      <td className="px-4 py-2">{p.likes.toLocaleString()}</td>
                      <td className="px-4 py-2">{p.comments.toLocaleString()}</td>
                      <td className="px-4 py-2">{p.shares.toLocaleString()}</td>
                      <td className="px-4 py-2">{p.avgEngagement.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-800">Top posts</h2>
            {data.awaitingMetrics > 0 && (
              <p className="text-xs text-slate-400">
                {data.awaitingMetrics} published post(s) have no metrics yet — they&apos;ll appear
                once the next pull runs.
              </p>
            )}
            <div className="space-y-2">
              {data.top.map((post, i) => (
                <div
                  key={post.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <span className="mt-0.5 w-5 text-sm font-semibold text-slate-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <PlatformBadge platform={post.platform} />
                      <span className="text-xs text-slate-400">
                        {PLATFORM_LABELS[post.platform]} · {new Date(post.publishedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-700">{post.bodyPreview}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    <div className="text-sm font-semibold text-slate-800">
                      {(post.metrics?.likes ?? 0).toLocaleString()} likes
                    </div>
                    <div>
                      {(post.metrics?.comments ?? 0).toLocaleString()} comments ·{" "}
                      {(post.metrics?.shares ?? 0).toLocaleString()} shares
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
