"use client";

import { useState, useTransition } from "react";
import { scheduleAllApprovedAction } from "@/app/actions";

export function ScheduleAllButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        disabled={pending || count === 0}
        onClick={() =>
          startTransition(async () => {
            const res = await scheduleAllApprovedAction();
            setMessage(res.message ?? null);
          })
        }
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Scheduling…" : `Schedule all approved (${count})`}
      </button>
      {message && <span className="text-sm text-emerald-700">{message}</span>}
    </div>
  );
}
