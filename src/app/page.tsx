import { GenerateForm } from "@/components/GenerateForm";
import { ScheduleAllButton } from "@/components/ScheduleAllButton";
import { VariantCard } from "@/components/VariantCard";
import { getReviewQueue, type ReviewQueueItem } from "@/server/service";

// Always render fresh; the review queue changes constantly.
export const dynamic = "force-dynamic";

function Section({
  title,
  hint,
  items,
}: {
  title: string;
  hint?: string;
  items: ReviewQueueItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-800">
          {title} <span className="text-slate-400">({items.length})</span>
        </h2>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((v) => (
          <VariantCard key={v.id} {...v} />
        ))}
      </div>
    </section>
  );
}

export default async function HomePage() {
  let queue: Awaited<ReturnType<typeof getReviewQueue>> | null = null;
  let dbError: string | null = null;
  try {
    queue = await getReviewQueue();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Morning review</h1>
        <p className="mt-1 text-sm text-slate-500">
          AI drafts your posts. Nothing publishes until you approve it here.
        </p>
      </div>

      <GenerateForm />

      {dbError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">Database not reachable yet.</p>
          <p className="mt-1">
            Set <code>DATABASE_URL</code>, then run <code>npm run db:migrate</code> and{" "}
            <code>npm run db:seed</code>. ({dbError})
          </p>
        </div>
      )}

      {queue && (
        <>
          <Section
            title="Pending review"
            hint="Approve, edit, schedule, or reject"
            items={queue.pending}
          />

          {queue.approved.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <ScheduleAllButton count={queue.approved.length} />
            </div>
          )}
          <Section
            title="Approved — awaiting schedule"
            hint="Drip across your daily slots"
            items={queue.approved}
          />

          <Section title="Scheduled" items={queue.scheduled} />
          <Section title="Recent (published / rejected / failed)" items={queue.recent} />

          {queue.pending.length === 0 &&
            queue.approved.length === 0 &&
            queue.scheduled.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                Nothing in the queue. Generate some drafts above to get started.
              </div>
            )}
        </>
      )}
    </div>
  );
}
