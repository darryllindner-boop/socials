"use client";

import { useRef, useState, useTransition } from "react";
import { generateAction } from "@/app/actions";
import { PLATFORMS, PLATFORM_LABELS } from "@/core/types";

export function GenerateForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await generateAction(formData);
          setMessage({ ok: res.ok, text: res.message ?? (res.ok ? "Done." : "Failed.") });
          if (res.ok) formRef.current?.reset();
        })
      }
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div>
        <label className="block text-sm font-medium text-slate-700">Topic</label>
        <input
          name="topic"
          required
          placeholder="e.g. how to get a sweeter pour-over at home"
          className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">
          Extra instruction <span className="text-slate-400">(optional)</span>
        </label>
        <input
          name="instruction"
          placeholder="e.g. mention our spring sale"
          className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
        />
      </div>
      <div>
        <span className="block text-sm font-medium text-slate-700">Platforms</span>
        <div className="mt-1 flex flex-wrap gap-3">
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="platforms" value={p} defaultChecked className="rounded" />
              {PLATFORM_LABELS[p]}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate drafts"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
