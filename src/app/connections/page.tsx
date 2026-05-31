import { PlatformBadge } from "@/components/PlatformBadge";
import { getConnectionStatuses } from "@/server/connections";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const statuses = await getConnectionStatuses();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Connections</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect each social account once its platform app is approved. Posts can be drafted and
          approved before a connection exists — publishing simply waits.
        </p>
      </div>

      <div className="space-y-3">
        {statuses.map((s) => (
          <div
            key={s.platform}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <PlatformBadge platform={s.platform} />
                {s.connected ? (
                  <span className="text-sm text-emerald-700">
                    Connected{s.displayName ? ` · ${s.displayName}` : ""}
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">Not connected</span>
                )}
              </div>
              <p className="max-w-2xl text-xs text-slate-500">{s.requirements}</p>
              <p className="text-xs text-slate-400">Scopes: {s.scopes.join(", ")}</p>
            </div>
            <div className="shrink-0">
              {s.appConfigured ? (
                <a
                  href={`/api/oauth/${s.platform}/start`}
                  className="inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white"
                >
                  {s.connected ? "Reconnect" : "Connect"}
                </a>
              ) : (
                <span className="inline-block rounded-lg border border-dashed border-slate-300 px-4 py-2 text-xs text-slate-400">
                  Set app credentials in .env
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
