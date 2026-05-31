import type { PostStatus, PostVariant } from "../types";

/**
 * The review state machine. Centralising allowed transitions here makes the
 * "nothing publishes without explicit approval" guarantee enforceable and
 * testable, instead of scattered across API handlers.
 */
const ALLOWED_TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  draft: ["pending_review", "rejected"],
  pending_review: ["approved", "rejected"],
  approved: ["scheduled", "rejected"],
  scheduled: ["publishing", "rejected"],
  publishing: ["published", "failed"],
  published: [],
  rejected: ["pending_review"], // allow re-opening a rejected draft
  failed: ["scheduled", "rejected"], // allow retry or give up
};

export class InvalidTransitionError extends Error {
  constructor(from: PostStatus, to: PostStatus) {
    super(`Invalid status transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PostStatus, to: PostStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export interface ReviewAction {
  type: "approve" | "reject" | "edit" | "schedule";
  /** For edit. */
  body?: string;
  hashtags?: string[];
  /** For schedule/approve-with-time (ISO 8601). */
  scheduledFor?: string;
}

/**
 * Apply a reviewer action to a variant, returning a new variant (immutable).
 * Throws InvalidTransitionError if the action is not allowed from the current
 * status.
 */
export function applyReviewAction(variant: PostVariant, action: ReviewAction): PostVariant {
  switch (action.type) {
    case "edit": {
      // Editing keeps the variant in review; it does not change status.
      return {
        ...variant,
        body: action.body ?? variant.body,
        hashtags: action.hashtags ?? variant.hashtags,
        error: undefined,
      };
    }
    case "approve": {
      assertTransition(variant.status, "approved");
      return { ...variant, status: "approved", error: undefined };
    }
    case "reject": {
      assertTransition(variant.status, "rejected");
      return { ...variant, status: "rejected" };
    }
    case "schedule": {
      assertTransition(variant.status, "scheduled");
      if (!action.scheduledFor) {
        throw new Error("schedule action requires scheduledFor");
      }
      return { ...variant, status: "scheduled", scheduledFor: action.scheduledFor };
    }
    default: {
      const _never: never = action.type;
      throw new Error(`Unknown review action: ${String(_never)}`);
    }
  }
}

/** Group variants into the buckets the morning review dashboard renders. */
export function groupForReview(variants: PostVariant[]): {
  pending: PostVariant[];
  approved: PostVariant[];
  scheduled: PostVariant[];
  done: PostVariant[];
} {
  const pending: PostVariant[] = [];
  const approved: PostVariant[] = [];
  const scheduled: PostVariant[] = [];
  const done: PostVariant[] = [];
  for (const v of variants) {
    if (v.status === "pending_review" || v.status === "draft") pending.push(v);
    else if (v.status === "approved") approved.push(v);
    else if (v.status === "scheduled" || v.status === "publishing") scheduled.push(v);
    else done.push(v);
  }
  return { pending, approved, scheduled, done };
}
