"use client";

import { useState, useTransition } from "react";
import {
  approveAction,
  editAction,
  rejectAction,
  scheduleVariantAction,
  setMediaAction,
} from "@/app/actions";
import { PLATFORM_RULES, type Platform, type PostStatus } from "@/core/types";
import { PlatformBadge } from "./PlatformBadge";

export interface VariantCardProps {
  id: string;
  platform: Platform;
  status: PostStatus;
  body: string;
  hashtags: string[];
  mediaUrls: string[];
  validationNote: string | null;
  scheduledFor: string | null;
  topic: string;
  accountConnected: boolean;
}

function defaultScheduleValue(): string {
  // Tomorrow 09:00 local, formatted for <input type="datetime-local">.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VariantCard(props: VariantCardProps) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(props.body);
  const [tags, setTags] = useState(props.hashtags.join(" "));
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue());
  const [showSchedule, setShowSchedule] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [mediaUrl, setMediaUrl] = useState(props.mediaUrls[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  const rule = PLATFORM_RULES[props.platform];
  const length = body.length + (tags ? tags.length + 1 : 0);
  const overLimit = length > rule.maxLength;
  const hasMedia = props.mediaUrls.length > 0;
  const needsMedia = props.platform === "instagram" && !hasMedia;

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Something went wrong.");
    });

  const isReviewable = props.status === "pending_review" || props.status === "draft";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={props.platform} />
          <span className="text-xs text-slate-400">{props.topic}</span>
        </div>
        <span className={`text-xs ${overLimit ? "text-red-600" : "text-slate-400"}`}>
          {length}/{rule.maxLength}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            className="w-full resize-y rounded-lg border border-slate-300 p-2 text-sm"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 p-2 text-sm"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="#hashtags separated by spaces"
          />
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const list = tags.split(/\s+/).filter(Boolean);
                  const res = await editAction(props.id, body, list);
                  if (res.ok) setEditing(false);
                  return res;
                })
              }
            >
              Save
            </button>
            <button
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              onClick={() => {
                setEditing(false);
                setBody(props.body);
                setTags(props.hashtags.join(" "));
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{body}</p>
          {tags && <p className="mt-2 text-sm text-brand-600">{tags}</p>}
          {hasMedia && (
            <div className="mt-2 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={props.mediaUrls[0]}
                alt="attached media"
                className="h-16 w-16 rounded-md border border-slate-200 object-cover"
              />
              <span className="text-xs text-slate-400">
                {props.mediaUrls.length} media attached
              </span>
            </div>
          )}
        </>
      )}

      {props.validationNote && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
          ⚠ {props.validationNote}
        </p>
      )}
      {!props.accountConnected && isReviewable && (
        <p className="mt-2 text-xs text-slate-400">
          Account not connected — you can approve/schedule now; publishing waits until you connect it.
        </p>
      )}
      {needsMedia && (
        <p className="mt-2 rounded-md bg-pink-50 px-2 py-1 text-xs text-pink-700">
          Instagram needs an image to publish. Use “Image…” to attach one.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {props.scheduledFor && (
        <p className="mt-2 text-xs text-emerald-700">
          Scheduled for {new Date(props.scheduledFor).toLocaleString()}
        </p>
      )}

      {isReviewable && !editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={pending}
            onClick={() => run(() => approveAction(props.id))}
          >
            Approve
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={pending}
            onClick={() => setShowMedia((s) => !s)}
          >
            Image…
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={pending}
            onClick={() => setShowSchedule((s) => !s)}
          >
            Schedule…
          </button>
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            disabled={pending}
            onClick={() => run(() => rejectAction(props.id))}
          >
            Reject
          </button>
        </div>
      )}

      {props.status === "approved" && (
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={pending}
            onClick={() => setShowMedia((s) => !s)}
          >
            Image…
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={pending}
            onClick={() => setShowSchedule((s) => !s)}
          >
            Schedule…
          </button>
          <span className="text-xs text-emerald-700">Approved</span>
        </div>
      )}

      {showMedia && (isReviewable || props.status === "approved") && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="url"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 p-1.5 text-sm"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="https://…/image.jpg (public URL)"
          />
          <button
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const urls = mediaUrl.trim() ? [mediaUrl.trim()] : [];
                const res = await setMediaAction(props.id, urls);
                if (res.ok) setShowMedia(false);
                return res;
              })
            }
          >
            Save image
          </button>
          {hasMedia && (
            <button
              className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  setMediaUrl("");
                  return setMediaAction(props.id, []);
                })
              }
            >
              Clear
            </button>
          )}
        </div>
      )}

      {showSchedule && (isReviewable || props.status === "approved") && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            className="rounded-lg border border-slate-300 p-1.5 text-sm"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
          <button
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await scheduleVariantAction(props.id, scheduleAt);
                if (res.ok) setShowSchedule(false);
                return res;
              })
            }
          >
            Confirm time
          </button>
        </div>
      )}
    </div>
  );
}
