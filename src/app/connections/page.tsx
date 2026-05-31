import { ConnectionCard } from "@/components/ConnectionCard";
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
          approved before a connection exists — publishing simply waits. Set an account to{" "}
          <span className="font-medium">Auto</span> to let Autopilot publish without review.
        </p>
      </div>

      <div className="space-y-3">
        {statuses.map((s) => (
          <ConnectionCard key={s.platform} status={s} />
        ))}
      </div>
    </div>
  );
}
