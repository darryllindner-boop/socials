"use client";

import { useState, useTransition } from "react";
import { setActiveAccountAction, setAutonomyAction } from "@/app/actions";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@/core/types";
import type { ConnectionStatus } from "@/server/connections";
import { PlatformBadge } from "./PlatformBadge";

const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  manual: "Manual (I post myself)",
  review_required: "Review required (approve each one)",
  auto: "Auto (publish without review)",
};

export function ConnectionCard({ status }: { status: ConnectionStatus }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const hasAccounts = status.accounts.length > 0;

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setMessage(null);
      const res = await fn();
      setMessage(res.message ?? null);
    });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={status.platform} />
            {hasAccounts ? (
              <span className="text-sm text-emerald-700">
                {status.accounts.length} account{status.accounts.length > 1 ? "s" : ""} connected
              </span>
            ) : (
              <span className="text-sm text-slate-400">Not connected</span>
            )}
          </div>
          <p className="max-w-2xl text-xs text-slate-500">{status.requirements}</p>
          <p className="text-xs text-slate-400">Scopes: {status.scopes.join(", ")}</p>
        </div>
        <div className="shrink-0">
          {status.appConfigured ? (
            <a
              href={`/api/oauth/${status.platform}/start`}
              className="inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white"
            >
              {hasAccounts ? "Reconnect / add" : "Connect"}
            </a>
          ) : (
            <span className="inline-block rounded-lg border border-dashed border-slate-300 px-4 py-2 text-xs text-slate-400">
              Set app credentials in .env
            </span>
          )}
        </div>
      </div>

      {hasAccounts && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          {status.accounts.map((acc) => (
            <div
              key={acc.id}
              className="flex flex-col gap-2 rounded-lg bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`active-${status.platform}`}
                  checked={acc.isActive}
                  disabled={pending || !acc.connected}
                  onChange={() => run(() => setActiveAccountAction(acc.id))}
                />
                <span className="font-medium text-slate-800">{acc.displayName}</span>
                {acc.isActive && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                    active
                  </span>
                )}
                {!acc.connected && <span className="text-xs text-amber-600">no token</span>}
              </label>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Autonomy</span>
                <select
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                  value={acc.autonomy}
                  disabled={pending}
                  onChange={(e) => run(() => setAutonomyAction(acc.id, e.target.value))}
                >
                  {AUTONOMY_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {AUTONOMY_LABELS[lvl]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {status.accounts.length > 1 && (
            <p className="text-xs text-slate-400">
              Pick which account this platform publishes as.
            </p>
          )}
        </div>
      )}

      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
    </div>
  );
}
