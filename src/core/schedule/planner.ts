import type { PostVariant } from "../types";

/**
 * Scheduling logic for the "approve in the morning, drip through the day" model.
 *
 * Timezone handling is offset-based to keep the core dependency-free. The
 * running app can pass the correct current UTC offset for the brand's IANA
 * timezone (e.g. via Intl) — or swap in a TZ library — without changing callers.
 */
export interface PlannerOptions {
  /** Preferred wall-clock hours (brand-local) to publish at, e.g. [9, 13, 17]. */
  slotHours: number[];
  /** Brand timezone offset from UTC, in minutes (Oslo summer = 120). */
  tzOffsetMinutes: number;
  /** Earliest instant we may schedule (usually "now"). */
  now: Date;
  /** How many days ahead we are willing to spread posts over. */
  horizonDays?: number;
}

interface LocalDate {
  y: number;
  m: number;
  d: number;
}

function brandLocalDate(now: Date, tzOffsetMinutes: number): LocalDate {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
}

/** UTC instant for a given brand-local day offset + wall-clock hour. */
function slotInstant(
  base: LocalDate,
  dayOffset: number,
  hour: number,
  tzOffsetMinutes: number,
): Date {
  const utcMillis =
    Date.UTC(base.y, base.m, base.d + dayOffset, hour, 0, 0) - tzOffsetMinutes * 60_000;
  return new Date(utcMillis);
}

/**
 * Produce the ordered list of available publishing slots strictly after `now`,
 * across the configured horizon.
 */
export function availableSlots(options: PlannerOptions): Date[] {
  const { slotHours, tzOffsetMinutes, now } = options;
  const horizon = options.horizonDays ?? 7;
  const base = brandLocalDate(now, tzOffsetMinutes);
  const sortedHours = [...slotHours].sort((a, b) => a - b);

  const slots: Date[] = [];
  for (let day = 0; day <= horizon; day++) {
    for (const hour of sortedHours) {
      const instant = slotInstant(base, day, hour, tzOffsetMinutes);
      if (instant.getTime() > now.getTime() + 60_000) {
        slots.push(instant);
      }
    }
  }
  return slots;
}

/**
 * Assign each approved variant the next free slot, scheduling at most one post
 * per slot. Returns new variant objects with `scheduledFor` set and status
 * advanced to "scheduled". Variants that are not "approved" pass through
 * unchanged. If there are more variants than slots, the overflow is returned in
 * `unscheduled` so the caller can surface it.
 */
export function planSchedule(
  variants: PostVariant[],
  options: PlannerOptions,
): { scheduled: PostVariant[]; unscheduled: PostVariant[] } {
  const slots = availableSlots(options);
  const scheduled: PostVariant[] = [];
  const unscheduled: PostVariant[] = [];
  let slotIndex = 0;

  for (const variant of variants) {
    if (variant.status !== "approved") {
      scheduled.push(variant);
      continue;
    }
    const slot = slots[slotIndex];
    if (!slot) {
      unscheduled.push(variant);
      continue;
    }
    slotIndex += 1;
    scheduled.push({
      ...variant,
      status: "scheduled",
      scheduledFor: slot.toISOString(),
    });
  }

  return { scheduled, unscheduled };
}

/**
 * The next time the daily review digest should be assembled (e.g. 07:00
 * brand-local). Used by the scheduler to wake the reviewer each morning.
 */
export function nextReviewWindow(now: Date, reviewHour: number, tzOffsetMinutes: number): Date {
  const base = brandLocalDate(now, tzOffsetMinutes);
  const today = slotInstant(base, 0, reviewHour, tzOffsetMinutes);
  if (today.getTime() > now.getTime()) return today;
  return slotInstant(base, 1, reviewHour, tzOffsetMinutes);
}
